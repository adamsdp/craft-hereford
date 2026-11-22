/**
 * Craft Hereford: product sheet -> Square payment links -> printable labels.
 *
 * Paste this file into the Google Sheet's Apps Script editor (Extensions ->
 * Apps Script) together with Labels.html. See docs/google-sheet-labels.md.
 *
 * The Square access token is stored in Script Properties, never in a cell.
 */

// ---- Configuration ---------------------------------------------------------
var SHEET_NAME = 'Products';
var MAKERS = 'Makers';
var LOCATIONS = 'Locations';
var SETTINGS = 'Settings';
var CURRENCY = 'GBP';
var SQUARE_VERSION = '2025-10-16';
var ACCEPT_WALLETS = true;   // offer Apple Pay and Google Pay on the checkout page (shown only on devices that support them)
var MAX_ROWS = 500;          // rows pre-filled with formulas and dropdowns on Products
var LIST_ROWS = 1000;        // rows covered by the Makers / Locations dropdown ranges

var HEADERS = [
  'Item code', 'Product description', 'Maker', 'Location', 'Price (GBP)',
  'Venue commission %', 'Selling commission %', 'Status',
  'Square link URL', 'Square link ID', 'Date listed', 'Sold date',
  'Venue commission (GBP)', 'Craft Hereford commission (GBP)', 'Maker receives (GBP)', 'Maker paid?', 'Venue paid?',
  'Square payment ID', 'Square fee (GBP)', 'Sync note'
];
var COL = {
  CODE: 1, DESC: 2, MAKER: 3, LOCATION: 4, PRICE: 5,
  VENUE_PCT: 6, SELL_PCT: 7, STATUS: 8,
  URL: 9, LINK_ID: 10, LISTED: 11, SOLD: 12,
  VENUE_GBP: 13, SELL_GBP: 14, MAKER_GBP: 15, PAID: 16, VENUE_PAID: 17,
  SQ_PAYMENT: 18, SQ_FEE: 19, SYNC_NOTE: 20
};
var MAKER_HEADERS = ['Name', 'Code', 'Email', 'Phone', 'Address', 'Outstanding (GBP)', 'Payment due?'];
var LOCATION_HEADERS = ['Name', 'Venue commission %', 'Code', 'Email', 'Phone', 'Address', 'Outstanding (GBP)', 'Payment due?'];

// Settings tab cells
var SET_VENUE_DEFAULT = 'B2';
var SET_SELL_DEFAULT = 'B3';
var SET_CHOICES_FIRST_ROW = 6;   // selling-commission choices are listed from A6 down

/** Saves pending changes to the sheet now, so they are visible even while a pop-up is open. */
function flush_() {
  if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
}

// ---- Menu ------------------------------------------------------------------
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Craft Hereford')
    .addItem('How to use this sheet', 'openStartHere')
    .addSeparator()
    .addItem('1. Create payment links for new items', 'createLinks')
    .addItem('2. Print tags', 'showLabelDialog')
    .addItem('3. Update sold items from Square', 'syncSales')
    .addSeparator()
    .addSubMenu(ui.createMenu('Print reports')
      .addItem('Monthly report', 'showPrintMonthly')
      .addItem('Statement for a maker or venue', 'showPrintStatement')
      .addItem('Outstanding payment for a maker or venue', 'showPrintOutstanding'))
    .addItem('Mark outstanding items as paid', 'markShownAsPaid')
    .addSeparator()
    .addSubMenu(ui.createMenu('Setup and checks (admin)')
      .addItem('Connect to Square', 'connectSquare')
      .addItem('Check Square connection', 'checkSquare')
      .addItem('Switch off links for sold items', 'disableSoldLinks')
      .addItem('Set up sheet (first time only)', 'setupSheet'))
    .addToUi();
}

// ---- Formulas (one per row; kept short so they are easy to read) ----------
function venueFormula_(r) {
  // Blank (not a guess) when the location is missing or has no rate, so the gap is visible.
  return '=IF(D' + r + '="","",IFERROR(VLOOKUP(D' + r + ',' + LOCATIONS + '!$A:$B,2,FALSE),""))';
}
function venueGbpFormula_(r) { return '=IF(OR(E' + r + '="",F' + r + '=""),"",ROUND(E' + r + '*F' + r + ',2))'; }
function sellGbpFormula_(r)  { return '=IF(OR(E' + r + '="",G' + r + '=""),"",ROUND(E' + r + '*G' + r + ',2))'; }
function makerGbpFormula_(r) { return '=IF(OR(M' + r + '="",N' + r + '=""),"",E' + r + '-M' + r + '-N' + r + ')'; }

/** Short code from a name in column A: initials ("Amanda Jones" -> AJ) or first 3 letters of a one-word name. */
function shortCodeFormula_(r) {
  var n = 'A' + r;
  return '=IF(' + n + '="","",IF(ISNUMBER(FIND(" ",TRIM(' + n + '))),' +
    'LEFT(REGEXREPLACE(UPPER(TRIM(' + n + ')),"([A-Z0-9])[A-Z0-9]*|[^A-Z0-9]","$1"),4),' +
    'UPPER(LEFT(REGEXREPLACE(TRIM(' + n + '),"[^A-Za-z0-9]",""),3))))';
}

// ---- First-time setup (safe to run again) ----------------------------------
function setupSheet() {
  var ss = SpreadsheetApp.getActive();

  // Reuse the tab imported from the CSV template; its old layout is cleared.
  var products = ss.getSheetByName(SHEET_NAME);
  if (!products) {
    var first = ss.getSheets()[0];
    if (first.getRange(1, 1).getValue() === HEADERS[0] && ss.getSheets().length === 1) {
      first.clear();
      first.setName(SHEET_NAME);
      products = first;
    } else {
      products = ss.insertSheet(SHEET_NAME);
    }
  }
  var makers = ss.getSheetByName(MAKERS) || ss.insertSheet(MAKERS);
  var locations = ss.getSheetByName(LOCATIONS) || ss.insertSheet(LOCATIONS);
  var settings = ss.getSheetByName(SETTINGS) || ss.insertSheet(SETTINGS);

  setupSettings_(settings);
  setupList_(makers, MAKER_HEADERS, ['Example Maker', '', 'maker@example.com', '07700 900000', '1 Example Street, Hereford'], 4, 2);
  setupList_(locations, LOCATION_HEADERS, ['Example Cafe', 0.10, '', 'cafe@example.com', '01432 000000', '2 High Town, Hereford'], 5, 3);
  locations.getRange(2, 2, LIST_ROWS - 1, 1).setNumberFormat('0.0%');
  // Amount Craft Hereford still owes each maker / venue: sold items whose Paid? box isn't ticked.
  setupOutstanding_(makers, 6, 'Products!$O:$O', 'Products!$C:$C', 'Products!$P:$P');
  setupOutstanding_(locations, 7, 'Products!$M:$M', 'Products!$D:$D', 'Products!$Q:$Q');
  setupProducts_(products, makers, locations, settings);

  ss.setActiveSheet(products);
  SpreadsheetApp.getUi().alert(
    'Sheet ready.\n\n1. Add your makers on the Makers tab and your venues on the Locations tab ' +
    '(delete the example rows).\n2. Add products on the Products tab and pick Maker and Location from the dropdowns.');
}

function setupSettings_(sh) {
  sh.getRange('A1:B1').setValues([['Setting', 'Value']]).setFontWeight('bold');
  sh.getRange('A2:A3').setValues([['Default venue commission'], ['Default selling commission']]);
  if (sh.getRange(SET_VENUE_DEFAULT).isBlank()) sh.getRange(SET_VENUE_DEFAULT).setValue(0.10);
  if (sh.getRange(SET_SELL_DEFAULT).isBlank()) sh.getRange(SET_SELL_DEFAULT).setValue(0.10);
  sh.getRange('A5').setValue('Selling commission choices (the dropdown on Products uses this list; add or edit values here)').setFontWeight('bold');
  var r = SET_CHOICES_FIRST_ROW;
  if (sh.getRange(r, 1).isBlank()) {
    sh.getRange(r, 1, 7, 1).setValues([[0], [0.05], [0.10], [0.15], [0.20], [0.25], [0.30]]);
  }
  sh.getRange(SET_VENUE_DEFAULT + ':' + SET_SELL_DEFAULT).setNumberFormat('0.0%');
  sh.getRange(r, 1, 30, 1).setNumberFormat('0.0%');
  sh.getRange('A6:A35').setHorizontalAlignment('left');
  sh.setColumnWidth(1, 330);
  sh.setColumnWidth(2, 90);
  sh.getRange('B2:B3').setBackground('#fff2cc');   // inputs you can change
}

function setupList_(sh, headers, exampleRow, phoneCol, codeCol) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (sh.getLastRow() < 2) sh.getRange(2, 1, 1, exampleRow.length).setValues([exampleRow]);

  // Short code for each name, used in item codes. It starts as a formula; type over it to choose your own.
  var formulas = [];
  for (var r = 2; r <= LIST_ROWS; r++) formulas.push([shortCodeFormula_(r)]);
  var codeRange = sh.getRange(2, codeCol, LIST_ROWS - 1, 1);
  var existing = codeRange.getFormulas();
  for (var i = 0; i < formulas.length; i++) {
    // Keep any code someone has typed over the formula.
    if (!existing[i][0] && sh.getRange(i + 2, codeCol).getValue() !== '') formulas[i] = [sh.getRange(i + 2, codeCol).getValue()];
  }
  codeRange.setFormulas(formulas);
  codeRange.setFontWeight('bold');

  // Phone numbers are text, so a leading 0 is never dropped.
  sh.getRange(2, phoneCol, LIST_ROWS - 1, 1).setNumberFormat('@');
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(codeCol, 70);
  sh.setColumnWidth(headers.length, 280);
}

function setupOutstanding_(sh, amountCol, sumRange, matchRange, paidRange) {
  var amountLetter = String.fromCharCode(64 + amountCol);
  var rows = [];
  for (var r = 2; r <= LIST_ROWS; r++) {
    rows.push([
      '=IF(A' + r + '="","",SUMIFS(' + sumRange + ',' + matchRange + ',A' + r + ',Products!$H:$H,"Sold",' + paidRange + ',"<>TRUE"))',
      '=IF(A' + r + '="","",IF(' + amountLetter + r + '>0,"Yes","No"))'
    ]);
  }
  sh.getRange(2, amountCol, LIST_ROWS - 1, 2).setFormulas(rows);
  sh.getRange(2, amountCol, LIST_ROWS - 1, 1).setNumberFormat('"£"0.00');
  sh.setColumnWidth(amountCol, 120);
  sh.setColumnWidth(amountCol + 1, 110);
  var due = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + String.fromCharCode(65 + amountCol) + '2="Yes"')
    .setBackground('#ffe599')
    .setRanges([sh.getRange(2, amountCol, LIST_ROWS - 1, 2)])
    .build();
  sh.setConditionalFormatRules(sh.getConditionalFormatRules().concat([due]));
}

function setupProducts_(sh, makers, locations, settings) {
  var n = MAX_ROWS;
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setWrap(true);
  sh.setFrozenRows(1);

  // Dropdowns
  var range = function (s, a1) { return s.getRange(a1); };
  sh.getRange(2, COL.MAKER, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(range(makers, 'A2:A' + LIST_ROWS), true)
    .setAllowInvalid(false).setHelpText('Pick a maker from the Makers tab').build());
  sh.getRange(2, COL.LOCATION, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(range(locations, 'A2:A' + LIST_ROWS), true)
    .setAllowInvalid(false).setHelpText('Pick a location from the Locations tab').build());
  sh.getRange(2, COL.SELL_PCT, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(range(settings, 'A' + SET_CHOICES_FIRST_ROW + ':A' + (SET_CHOICES_FIRST_ROW + 29)), true)
    .setAllowInvalid(false).setHelpText('Choose a rate; to add rates, edit the list on the Settings tab').build());
  sh.getRange(2, COL.STATUS, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Draft', 'Listed', 'Sold'], true).build());

  // Formulas. A Sold row keeps its frozen venue % so later rate changes don't alter it.
  var status = sh.getRange(2, COL.STATUS, n, 1).getValues();
  var venueCol = sh.getRange(2, COL.VENUE_PCT, n, 1).getFormulas();
  var venueVals = sh.getRange(2, COL.VENUE_PCT, n, 1).getValues();
  var venue = [], gbp = [];
  for (var i = 0; i < n; i++) {
    var r = i + 2;
    if (status[i][0] === 'Sold' && !venueCol[i][0] && venueVals[i][0] !== '') venue.push([venueVals[i][0]]);
    else venue.push([venueFormula_(r)]);
    gbp.push([venueGbpFormula_(r), sellGbpFormula_(r), makerGbpFormula_(r)]);
  }
  sh.getRange(2, COL.VENUE_PCT, n, 1).setFormulas(venue);
  sh.getRange(2, COL.VENUE_GBP, n, 3).setFormulas(gbp);

  // Light green on the columns people fill in (headings use a stronger green).
  [[COL.DESC, 4], [COL.SELL_PCT, 2], [COL.PAID, 2]].forEach(function (c) {
    sh.getRange(2, c[0], n, c[1]).setBackground('#eef6ea');
  });

  // Tick boxes: has the maker / the venue been paid?
  sh.getRange(2, COL.PAID, n, 2).insertCheckboxes();

  // Formats
  sh.getRange(2, COL.PRICE, n, 1).setNumberFormat('"£"0.00');
  sh.getRange(2, COL.VENUE_PCT, n, 2).setNumberFormat('0.0%');
  sh.getRange(2, COL.VENUE_GBP, n, 3).setNumberFormat('"£"0.00');
  sh.getRange(2, COL.SQ_FEE, n, 1).setNumberFormat('"£"0.00');
  sh.getRange(2, COL.LISTED, n, 2).setNumberFormat('dd mmm yyyy');
  sh.getRange(2, COL.VENUE_PCT, n, 1).setFontColor('#555555');          // set by the location
  sh.getRange(2, COL.LINK_ID, n, 1).setFontColor('#888888');
  sh.getRange(2, COL.VENUE_GBP, n, 3).setBackground('#f3f3f3');         // calculated
  sh.getRange(1, COL.VENUE_GBP, 1, 3).setBackground('#e0e0e0');

  var widths = [90, 260, 150, 150, 90, 110, 110, 80, 220, 130, 100, 100, 120, 140, 120, 90, 90, 190, 100, 300];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}

// ---- Automatic defaults when you type in the sheet -------------------------
/** Simple trigger: runs on every manual edit, no authorisation needed. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var name = sh.getName();
  if (name === SHEET_NAME) productsEdited_(sh, e.range);
  else if (name === LOCATIONS) locationsEdited_(sh, e.range);
}

function settingNumber_(a1, fallback) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  var v = sh ? sh.getRange(a1).getValue() : '';
  return typeof v === 'number' ? v : fallback;
}

/** True once an item has a payment link, a payment, or is Listed/Sold: from then on its code must not change. */
function isCommitted_(sh, r) {
  var status = sh.getRange(r, COL.STATUS).getValue();
  return String(sh.getRange(r, COL.URL).getValue()).trim() !== '' ||
         String(sh.getRange(r, COL.LINK_ID).getValue()).trim() !== '' ||
         String(sh.getRange(r, COL.SQ_PAYMENT).getValue()).trim() !== '' ||
         status === 'Listed' || status === 'Sold';
}

function productsEdited_(sh, rg) {
  var first = Math.max(rg.getRow(), 2);
  var last = Math.min(rg.getRow() + rg.getNumRows() - 1, MAX_ROWS + 1);
  var sellDefault = settingNumber_(SET_SELL_DEFAULT, 0.10);
  var lookups = null, existing = null;
  var c1 = rg.getColumn(), c2 = c1 + rg.getNumColumns() - 1;
  var touchedWho = c1 <= COL.LOCATION && c2 >= COL.MAKER;       // was a Maker or Location cell edited?
  for (var r = first; r <= last; r++) {
    // New product: fill the default selling commission.
    var hasDesc = String(sh.getRange(r, COL.DESC).getValue()).trim() !== '';
    var sell = sh.getRange(r, COL.SELL_PCT);
    if (hasDesc && sell.getValue() === '') sell.setValue(sellDefault);

    // The item code follows the chosen maker and location until the payment link is made.
    var codeCell = sh.getRange(r, COL.CODE);
    var curCode = String(codeCell.getValue()).trim();
    var maker = sh.getRange(r, COL.MAKER).getValue(), loc = sh.getRange(r, COL.LOCATION).getValue();
    var makerName = String(maker).trim(), locName = String(loc).trim();
    var needLookups = function () {
      if (!lookups) {
        lookups = codeLookups_();
        existing = sh.getRange(2, COL.CODE, MAX_ROWS, 1).getValues().map(function (x) { return x[0]; });
      }
    };

    if (curCode !== '' && touchedWho) {
      if (isCommitted_(sh, r)) {
        // A link (or a sale) already uses this code, so it stays. Say so if the maker or venue no longer matches it.
        needLookups();
        var mc0 = lookups.makers[makerName], lc0 = lookups.locations[locName];
        if (mc0 && lc0 && curCode.indexOf(lc0 + '-' + mc0 + '-') !== 0) {
          try {
            SpreadsheetApp.getActive().toast('This item already has a payment link, so its code (' + curCode + ') has not changed. ' +
              'To change it, delete this item (right-click its row number, then Delete row) and add it again as a new item.',
              'Item code kept', 12);
          } catch (e) { /* a message is only a courtesy */ }
        }
      } else if (makerName === '' || locName === '') {
        codeCell.setValue('');                       // maker or venue removed: the code no longer means anything
        needLookups(); existing[r - 2] = '';
        curCode = '';
      } else {
        needLookups();
        var mc = lookups.makers[makerName], lc = lookups.locations[locName];
        if (mc && lc && curCode.indexOf(lc + '-' + mc + '-') !== 0) {
          existing[r - 2] = '';                      // the old code is being replaced
          var fresh = itemCodeFor_(lookups, makerName, locName, existing);
          if (fresh) { codeCell.setValue(fresh); curCode = fresh; }
        }
      }
    }
    if (curCode === '' && makerName !== '' && locName !== '') {
      needLookups();
      var newCode = itemCodeFor_(lookups, maker, loc, existing);
      if (newCode) { codeCell.setValue(newCode); existing[r - 2] = newCode; }
    }

    // Status changes: freeze the venue % when Sold, restore the formula otherwise.
    var status = sh.getRange(r, COL.STATUS).getValue();
    var venue = sh.getRange(r, COL.VENUE_PCT);
    if (status === 'Sold') {
      if (venue.getFormula()) venue.setValue(venue.getValue());
      var sold = sh.getRange(r, COL.SOLD);
      if (sold.getValue() === '') sold.setValue(new Date());
    } else if (!venue.getFormula()) {
      venue.setFormula(venueFormula_(r));
    }
  }
}

function locationsEdited_(sh, rg) {
  var first = Math.max(rg.getRow(), 2);
  var last = Math.min(rg.getRow() + rg.getNumRows() - 1, LIST_ROWS);
  var venueDefault = settingNumber_(SET_VENUE_DEFAULT, 0.10);
  for (var r = first; r <= last; r++) {
    var named = String(sh.getRange(r, 1).getValue()).trim() !== '';
    var pct = sh.getRange(r, 2);
    if (named && pct.getValue() === '') pct.setValue(venueDefault);
  }
}

// ---- Square connection -----------------------------------------------------
function connectSquare() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var env = ui.prompt('Square environment',
    'Type "sandbox" to test with fake payments, or "live" for real payments.',
    ui.ButtonSet.OK_CANCEL);
  if (env.getSelectedButton() !== ui.Button.OK) return;
  var envText = env.getResponseText().trim().toLowerCase();
  if (envText !== 'sandbox' && envText !== 'live') { ui.alert('Please type sandbox or live.'); return; }

  var token = ui.prompt('Square access token',
    'Paste the ' + envText + ' access token from the Square Developer Dashboard. ' +
    'Use the Sandbox token for "sandbox" and the Production token for "live".',
    ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) return;
  var tokenText = token.getResponseText().trim();

  // Check the token and find the Square location(s) it can use.
  var base = envText === 'live' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  var res = UrlFetchApp.fetch(base + '/v2/locations', {
    headers: { Authorization: 'Bearer ' + tokenText, 'Square-Version': SQUARE_VERSION },
    muteHttpExceptions: true
  });
  var json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { json = {}; }
  if (res.getResponseCode() >= 300 || !json.locations) {
    var why = json.errors && json.errors[0] ? (json.errors[0].detail || json.errors[0].code) : 'HTTP ' + res.getResponseCode();
    ui.alert('Square did not accept that token (' + why + ').\n\n' +
      'Check that you copied the ' + envText + ' access token, with no spaces, and that you typed the matching environment.');
    return;
  }
  var locs = json.locations.filter(function (l) { return !l.status || l.status === 'ACTIVE'; });
  if (!locs.length) { ui.alert('That Square account has no active locations.'); return; }

  var chosen = locs[0];
  if (locs.length > 1) {
    var list = locs.map(function (l, i) {
      return (i + 1) + '. ' + (l.name || l.id) + ' (' + (l.country || '?') + ', ' + (l.currency || '?') + ')';
    }).join('\n');
    var pick = ui.prompt('Which Square location?', 'Type the number:\n\n' + list, ui.ButtonSet.OK_CANCEL);
    if (pick.getSelectedButton() !== ui.Button.OK) return;
    var n = parseInt(pick.getResponseText().trim(), 10);
    if (!(n >= 1 && n <= locs.length)) { ui.alert('Please type one of the numbers listed.'); return; }
    chosen = locs[n - 1];
  }

  if (chosen.currency && chosen.currency !== CURRENCY) {
    var go = ui.alert('Currency mismatch',
      'This location takes payments in ' + chosen.currency + ', but this sheet creates links in ' + CURRENCY + '. ' +
      'Square may refuse them. (For testing, create a UK sandbox test account in the Developer Dashboard and use its token.)\n\nSave this connection anyway?',
      ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) return;
  }

  props.setProperties({ SQUARE_ENV: envText, SQUARE_TOKEN: tokenText, SQUARE_LOCATION: chosen.id });
  props.deleteProperty('SQUARE_LAST_SYNC');   // a new connection starts its own sync history
  ui.alert('Connected to Square (' + envText + ').\nLocation: ' + (chosen.name || chosen.id) +
    (chosen.currency ? ' (' + chosen.currency + ')' : '') + '.');
}

function squareConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  if (!p.SQUARE_TOKEN || !p.SQUARE_LOCATION) {
    throw new Error('Square is not connected yet. Use Craft Hereford > Connect to Square.');
  }
  return {
    base: p.SQUARE_ENV === 'live' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com',
    token: p.SQUARE_TOKEN,
    location: p.SQUARE_LOCATION,
    env: p.SQUARE_ENV || 'sandbox'
  };
}

// ---- Pure helpers (unit-tested outside Google) -----------------------------
/** "12.5", 12.5 or "£12.50" -> 1250 (pence), or null if not a valid price. */
function toPence(value) {
  var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function linkName(code, desc, maker) {
  var name = code + ' ' + desc + (maker ? ' (' + maker + ')' : '');
  return name.length > 255 ? name.substring(0, 252) + '...' : name;
}

/** Same rule as the sheet formula, used when a name has no code yet. */
function initialsCode_(name) {
  var t = String(name).trim();
  if (!t) return '';
  if (t.indexOf(' ') >= 0) {
    return t.toUpperCase().replace(/([A-Z0-9])[A-Z0-9]*|[^A-Z0-9]/g, '$1').substring(0, 4);
  }
  return t.replace(/[^A-Za-z0-9]/g, '').substring(0, 3).toUpperCase();
}

/** LOCATION-MAKER-NNN, counting up per location + maker pair. */
function buildItemCode_(locCode, makerCode, existingCodes) {
  var prefix = locCode + '-' + makerCode + '-';
  var max = 0;
  existingCodes.forEach(function (c) {
    c = String(c);
    if (c.indexOf(prefix) === 0) {
      var m = c.substring(prefix.length).match(/^(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  });
  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return prefix + n;
}

/** Reads the Makers and Locations tabs once: name -> code. */
function codeLookups_() {
  var ss = SpreadsheetApp.getActive();
  var out = { makers: {}, locations: {} };
  var m = ss.getSheetByName(MAKERS), l = ss.getSheetByName(LOCATIONS);
  if (m) m.getRange(2, 1, LIST_ROWS - 1, 2).getValues().forEach(function (r) {
    var n = String(r[0]).trim(); if (n) out.makers[n] = String(r[1]).trim().toUpperCase() || initialsCode_(n);
  });
  if (l) l.getRange(2, 1, LIST_ROWS - 1, 3).getValues().forEach(function (r) {
    var n = String(r[0]).trim(); if (n) out.locations[n] = String(r[2]).trim().toUpperCase() || initialsCode_(n);
  });
  return out;
}

/** Item code for a maker + location, or '' if either is unknown. existingCodes is updated. */
function itemCodeFor_(lookups, maker, location, existingCodes) {
  var mc = lookups.makers[String(maker).trim()];
  var lc = lookups.locations[String(location).trim()];
  if (!mc || !lc) return '';
  var code = buildItemCode_(lc, mc, existingCodes);
  existingCodes.push(code);
  return code;
}

function buildPaymentLinkBody(row, locationId, idempotencyKey) {
  var body = {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name: linkName(row.code, row.desc, row.maker),
      price_money: { amount: row.pence, currency: CURRENCY },
      location_id: locationId
    },
    payment_note: row.code + ' | ' + row.maker + ' | ' + (row.location || '') + ' | ' + row.desc
  };
  if (ACCEPT_WALLETS) {
    body.checkout_options = { accepted_payment_methods: { apple_pay: true, google_pay: true } };
  }
  return body;
}

// ---- Create links ----------------------------------------------------------
function createLinks() {
  var ui = SpreadsheetApp.getUi();
  var cfg = squareConfig_();
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sh) { ui.alert('Run Craft Hereford > Set up sheet first.'); return; }

  var last = sh.getLastRow();
  if (last < 2) { ui.alert('No products yet.'); return; }
  var range = sh.getRange(2, 1, last - 1, HEADERS.length);
  var data = range.getValues();
  var codes = data.map(function (r) { return r[COL.CODE - 1]; }).filter(String);
  var lookups = codeLookups_();

  var made = 0, walletsRefused = 0, problems = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var rowNum = i + 2;
    if (r[COL.URL - 1] || !String(r[COL.DESC - 1]).trim()) continue; // already has link / empty row
    if (r[COL.STATUS - 1] === 'Sold') continue;   // never make a link for something already sold

    var pence = toPence(r[COL.PRICE - 1]);
    if (!pence) { problems.push('Row ' + rowNum + ': missing or invalid price'); continue; }
    if (!String(r[COL.MAKER - 1]).trim()) { problems.push('Row ' + rowNum + ': missing maker'); continue; }
    if (!String(r[COL.LOCATION - 1]).trim()) { problems.push('Row ' + rowNum + ': missing location'); continue; }

    if (typeof r[COL.VENUE_PCT - 1] !== 'number') { problems.push('Row ' + rowNum + ': no venue commission (check the location has one on the Locations tab)'); continue; }
    if (typeof r[COL.SELL_PCT - 1] !== 'number') { problems.push('Row ' + rowNum + ': no selling commission'); continue; }

    var code = String(r[COL.CODE - 1]).trim();
    if (!code) {
      code = itemCodeFor_(lookups, r[COL.MAKER - 1], r[COL.LOCATION - 1], codes);
      if (!code) { problems.push('Row ' + rowNum + ': could not make a code (maker or location not found on its tab)'); continue; }
    }

    var body = buildPaymentLinkBody({
      code: code,
      desc: String(r[COL.DESC - 1]).trim(),
      maker: String(r[COL.MAKER - 1]).trim(),
      location: String(r[COL.LOCATION - 1]).trim(),
      pence: pence
    }, cfg.location, Utilities.getUuid());

    var post = function (b) {
      return UrlFetchApp.fetch(cfg.base + '/v2/online-checkout/payment-links', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + cfg.token, 'Square-Version': SQUARE_VERSION },
        payload: JSON.stringify(b),
        muteHttpExceptions: true
      });
    };
    var res = post(body);
    var json = JSON.parse(res.getContentText() || '{}');
    // If Square refuses the Apple Pay / Google Pay setting, make the link without it rather than fail.
    if (res.getResponseCode() >= 300 && body.checkout_options) {
      var plain = JSON.parse(JSON.stringify(body));
      delete plain.checkout_options;
      plain.idempotency_key = Utilities.getUuid();
      var res2 = post(plain);
      var json2 = JSON.parse(res2.getContentText() || '{}');
      if (res2.getResponseCode() < 300 && json2.payment_link) {
        res = res2; json = json2; walletsRefused++;
      }
    }
    if (res.getResponseCode() >= 300 || !json.payment_link) {
      var msg = json.errors && json.errors[0] ? json.errors[0].detail || json.errors[0].code : 'HTTP ' + res.getResponseCode();
      problems.push('Row ' + rowNum + ': Square said: ' + msg);
      continue;
    }

    sh.getRange(rowNum, COL.CODE).setValue(code);
    sh.getRange(rowNum, COL.URL).setValue(json.payment_link.url);
    sh.getRange(rowNum, COL.LINK_ID).setValue(json.payment_link.id);
    if (!r[COL.LISTED - 1]) sh.getRange(rowNum, COL.LISTED).setValue(new Date());   // keep an existing listed date
    sh.getRange(rowNum, COL.STATUS).setValue('Listed');
    made++;
  }

  var summary = made + ' payment link(s) created' + (cfg.env === 'sandbox' ? ' (TEST mode: no real payments)' : '') + '.';
  if (made) summary += '\n\nNext: print the tags with "2. Print tags".';
  if (walletsRefused) summary += '\n\nNote: Square would not accept the Apple Pay / Google Pay setting for ' + walletsRefused + ' link(s), so those links were made without it.';
  if (problems.length) summary += '\n\nThese items need fixing before they can get a link:\n' + problems.join('\n');
  flush_();
  ui.alert(summary);
}

// ---- Switch off links for sold items --------------------------------------
function disableSoldLinks() {
  var ui = SpreadsheetApp.getUi();
  var cfg = squareConfig_();
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  var r = switchOffSoldLinks_(sh, cfg);
  flush_();
  ui.alert(r.done + ' link(s) switched off.' + (r.problems.length ? '\n\n' + r.problems.join('\n') : ''));
}

/** Deletes the Square link of every Sold item that still has one. Returns {done, problems}. */
function switchOffSoldLinks_(sh, cfg) {
  var out = { done: 0, problems: [] };
  var last = sh.getLastRow();
  if (last < 2) return out;
  var data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  data.forEach(function (r, i) {
    if (r[COL.STATUS - 1] !== 'Sold' || !r[COL.LINK_ID - 1]) return;
    var res = UrlFetchApp.fetch(cfg.base + '/v2/online-checkout/payment-links/' + r[COL.LINK_ID - 1], {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Square-Version': SQUARE_VERSION },
      muteHttpExceptions: true
    });
    // 404 means the link is already gone, which is fine.
    if (res.getResponseCode() < 300 || res.getResponseCode() === 404) {
      sh.getRange(i + 2, COL.LINK_ID).setValue('');
      sh.getRange(i + 2, COL.URL).setValue('(switched off)');
      if (!r[COL.SOLD - 1]) sh.getRange(i + 2, COL.SOLD).setValue(new Date());
      out.done++;
    } else {
      out.problems.push('Row ' + (i + 2) + ': HTTP ' + res.getResponseCode());
    }
  });
  return out;
}

// ---- Sync sales from Square ------------------------------------------------
var SYNC_FIRST_LOOKBACK_DAYS = 90;
var DAY_MS = 24 * 3600 * 1000;

/** Finds an item code such as HCH-AJ-001 in a payment note or an order line name. */
function codeFromText_(text) {
  var m = String(text || '').match(/\b([A-Z0-9]{1,8}-[A-Z0-9]{1,8}-\d{3,})\b/);
  return m ? m[1] : '';
}

function pounds_(pence) { return '£' + (pence / 100).toFixed(2); }

function sumFees_(p) {
  return (p.processing_fee || []).reduce(function (t, f) {
    return t + ((f.amount_money && f.amount_money.amount) || 0);
  }, 0);
}

function squareGet_(cfg, path) {
  var res = UrlFetchApp.fetch(cfg.base + path, {
    headers: { Authorization: 'Bearer ' + cfg.token, 'Square-Version': SQUARE_VERSION },
    muteHttpExceptions: true
  });
  var json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { json = {}; }
  if (res.getResponseCode() >= 300) {
    var why = json.errors && json.errors[0] ? (json.errors[0].detail || json.errors[0].code) : 'HTTP ' + res.getResponseCode();
    throw new Error(why);
  }
  return json;
}

/** All payments at this location between two dates, oldest first. */
function fetchPayments_(cfg, begin, end) {
  var out = [], cursor = '';
  do {
    var json = squareGet_(cfg, '/v2/payments?sort_order=ASC&limit=100' +
      '&location_id=' + encodeURIComponent(cfg.location) +
      '&begin_time=' + encodeURIComponent(begin.toISOString()) +
      '&end_time=' + encodeURIComponent(end.toISOString()) +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    out = out.concat(json.payments || []);
    cursor = json.cursor || '';
  } while (cursor);
  return out;
}

/** Item names on an order, used when a payment has no note. */
function fetchOrderText_(cfg, orderId) {
  var json = squareGet_(cfg, '/v2/orders/' + encodeURIComponent(orderId));
  var items = (json.order && json.order.line_items) || [];
  return items.map(function (l) { return l.name; }).join(' ');
}

/**
 * Applies Square payments to the Products tab. Returns
 * {newlySold, alreadyDone, flagged, unmatched}. Safe to run repeatedly.
 */
function applyPayments_(sh, payments, orderText) {
  var res = { newlySold: [], alreadyDone: 0, flagged: [], unmatched: [] };
  var last = sh.getLastRow();
  if (last < 2) return res;
  var data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var byCode = {};
  data.forEach(function (r, i) {
    var c = String(r[COL.CODE - 1]).trim();
    if (c && byCode[c] === undefined) byCode[c] = i;
  });

  payments.forEach(function (p) {
    if (p.status !== 'COMPLETED') return;
    var paid = (p.amount_money && p.amount_money.amount) || 0;
    var code = codeFromText_(p.note);
    if (!code && p.order_id && orderText) {
      try { code = codeFromText_(orderText(p.order_id)); } catch (e) { code = ''; }
    }
    if (!code) { res.unmatched.push(pounds_(paid) + ' payment ' + p.id + ' (no item code: not from a sheet link)'); return; }
    var i = byCode[code];
    if (i === undefined) { res.unmatched.push(code + ' (not on the Products tab)'); return; }

    var r = data[i], rowNum = i + 2;
    var when = new Date(p.created_at);
    var existing = String(r[COL.SQ_PAYMENT - 1]).trim();
    var oldNote = String(r[COL.SYNC_NOTE - 1]).trim();

    // A second, different payment for an item that was already paid for.
    if (existing && existing !== p.id) {
      var twice = 'Paid twice in Square: ' + p.id + ' (' + pounds_(paid) + ')';
      if (oldNote.indexOf(twice) < 0) {
        sh.getRange(rowNum, COL.SYNC_NOTE).setValue((oldNote ? oldNote + '; ' : '') + twice);
        res.flagged.push(code + ': ' + twice);
      }
      return;
    }

    var notes = [], changed = false;
    if (!existing) {
      if (r[COL.STATUS - 1] === 'Sold') {
        // Marked sold by hand earlier: keep that, but point out a big date gap.
        var hand = r[COL.SOLD - 1] ? new Date(r[COL.SOLD - 1]) : null;
        if (hand && isFinite(hand) && Math.abs(hand - when) > 2 * DAY_MS) {
          notes.push('Marked sold ' + hand.toISOString().slice(0, 10) + ' but paid ' + when.toISOString().slice(0, 10));
        }
      } else {
        sh.getRange(rowNum, COL.STATUS).setValue('Sold');
        sh.getRange(rowNum, COL.SOLD).setValue(when);
        var venue = sh.getRange(rowNum, COL.VENUE_PCT);          // freeze the venue rate, as marking Sold by hand does
        if (venue.getFormula()) venue.setValue(venue.getValue());
        res.newlySold.push(code);
        data[i][COL.STATUS - 1] = 'Sold';
      }
      sh.getRange(rowNum, COL.SQ_PAYMENT).setValue(p.id);
      sh.getRange(rowNum, COL.SQ_FEE).setValue(sumFees_(p) / 100);
      data[i][COL.SQ_PAYMENT - 1] = p.id;
      changed = true;
    }

    // Checks that apply every time: price and refunds.
    var price = toPence(r[COL.PRICE - 1]);
    if (price && paid !== price) notes.push('Paid ' + pounds_(paid) + ' but price is ' + pounds_(price));
    var refunded = (p.refunded_money && p.refunded_money.amount) || 0;
    if (refunded > 0) notes.push('Refunded ' + pounds_(refunded) + ' in Square: review this sale');
    notes = notes.filter(function (n) { return oldNote.indexOf(n) < 0; });
    if (notes.length) {
      sh.getRange(rowNum, COL.SYNC_NOTE).setValue((oldNote ? oldNote + '; ' : '') + notes.join('; '));
      res.flagged.push(code + ': ' + notes.join('; '));
      changed = true;
    }
    if (!changed) res.alreadyDone++;
  });
  return res;
}

function listShort_(items, max) {
  var shown = items.slice(0, max).join('\n  ');
  return '\n  ' + shown + (items.length > max ? '\n  ...and ' + (items.length - max) + ' more' : '');
}

function syncSales() {
  var ui = SpreadsheetApp.getUi();
  var cfg = squareConfig_();
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sh) { ui.alert('Run Craft Hereford > Set up sheet first.'); return; }
  var props = PropertiesService.getScriptProperties();

  var now = new Date();
  var lastSync = props.getProperty('SQUARE_LAST_SYNC');
  var begin = lastSync ? new Date(new Date(lastSync).getTime() - DAY_MS)       // a day of overlap; repeats are harmless
                       : new Date(now.getTime() - SYNC_FIRST_LOOKBACK_DAYS * DAY_MS);

  var payments;
  try { payments = fetchPayments_(cfg, begin, now); }
  catch (e) { ui.alert('Could not read payments from Square.\n\n' + e.message); return; }

  var res = applyPayments_(sh, payments, function (id) { return fetchOrderText_(cfg, id); });
  var off = switchOffSoldLinks_(sh, cfg);
  props.setProperty('SQUARE_LAST_SYNC', now.toISOString());

  var byStatus = {};
  payments.forEach(function (p) { byStatus[p.status || '?'] = (byStatus[p.status || '?'] || 0) + 1; });
  var statusText = Object.keys(byStatus).map(function (k) { return byStatus[k] + ' ' + k.toLowerCase(); }).join(', ');

  var msg = 'Updated from Square' + (cfg.env === 'sandbox' ? ' (TEST mode)' : '') + '. Payments since ' + begin.toISOString().slice(0, 10) + '.\n\n' +
    '• Square returned ' + payments.length + ' payment(s) for this location' + (payments.length ? ' (' + statusText + ')' : '') + '\n' +
    '• ' + res.newlySold.length + ' item(s) newly marked Sold' + (res.newlySold.length ? ':' + listShort_(res.newlySold, 10) : '') + '\n' +
    '• ' + res.alreadyDone + ' already up to date\n' +
    '• ' + off.done + ' link(s) switched off';
  if (off.problems.length) msg += '\n  (could not switch off: ' + off.problems.join('; ') + ')';
  if (res.flagged.length) msg += '\n\nNeeds your attention (also in the Sync note column):' + listShort_(res.flagged, 10);
  if (res.unmatched.length) msg += '\n\nPayments not matched to an item:' + listShort_(res.unmatched, 10);
  if (!payments.length) {
    msg += '\n\nNo payments found. Check that the test payment was completed through one of this sheet\'s links, ' +
      'in the same Square environment (' + cfg.env + ') and at the same location, and that it appears in the Square ' +
      cfg.env + ' dashboard under Payments. New payments can take a minute to show up.';
  }
  flush_();
  ui.alert(msg);
}

// ---- Check Square connection ------------------------------------------------
function squarePost_(cfg, path, body) {
  var res = UrlFetchApp.fetch(cfg.base + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Square-Version': SQUARE_VERSION },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { json = {}; }
  if (res.getResponseCode() >= 300) {
    var why = json.errors && json.errors[0] ? (json.errors[0].detail || json.errors[0].code) : 'HTTP ' + res.getResponseCode();
    throw new Error(why);
  }
  return json;
}

function statusSummary_(items) {
  var by = {};
  items.forEach(function (x) { var k = String(x.status || x.state || '?').toLowerCase(); by[k] = (by[k] || 0) + 1; });
  var parts = Object.keys(by).map(function (k) { return by[k] + ' ' + k; });
  return parts.length ? ' (' + parts.join(', ') + ')' : '';
}

/** Reports what Square can see for this connection, to find out why something is missing. */
function checkSquare() {
  var ui = SpreadsheetApp.getUi();
  var cfg = squareConfig_();
  var since = new Date(Date.now() - 90 * DAY_MS), now = new Date();
  var lines = ['Environment: ' + cfg.env, 'Location ID in use: ' + cfg.location];
  try {
    var scriptTz = Session.getScriptTimeZone();
    var sheetTz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    lines.push('Time zones: script ' + scriptTz + ', sheet ' + sheetTz +
      (scriptTz === sheetTz ? ' (match)' : ' (DIFFERENT: set both to Europe/London)'));
  } catch (e) { lines.push('Time zones: could not read'); }
  lines.push('');
  var locs = [];

  try {
    locs = squareGet_(cfg, '/v2/locations').locations || [];
    var mine = locs.filter(function (l) { return l.id === cfg.location; })[0];
    lines.push('Token works. Locations on this account: ' + locs.length);
    lines.push('Location in use: ' + (mine ? (mine.name || mine.id) + ' (' + (mine.country || '?') + ', ' + (mine.currency || '?') + ')'
                                           : 'NOT FOUND for this token. Run Connect to Square again.'));
  } catch (e) { lines.push('Could not read locations: ' + e.message); }

  try {
    var links = squareGet_(cfg, '/v2/online-checkout/payment-links?limit=100');
    lines.push('Payment links on this account: ' + (links.payment_links || []).length + (links.cursor ? '+' : ''));
  } catch (e) { lines.push('Could not read payment links: ' + e.message); }

  try {
    var orders = squarePost_(cfg, '/v2/orders/search', {
      location_ids: [cfg.location], limit: 100,
      query: { filter: { date_time_filter: { created_at: { start_at: since.toISOString() } } },
               sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' } }
    }).orders || [];
    var paid = orders.filter(function (o) { return (o.tenders || []).length > 0; }).length;
    lines.push('Orders at this location, last 90 days: ' + orders.length + statusSummary_(orders) + ' (' + paid + ' with a payment)');
  } catch (e) { lines.push('Could not read orders: ' + e.message); }

  var shown = locs.length ? locs.slice(0, 10) : [{ id: cfg.location, name: cfg.location }];
  shown.forEach(function (l) {
    try {
      var ps = fetchPayments_({ base: cfg.base, token: cfg.token, location: l.id }, since, now);
      lines.push('Payments at ' + (l.name || l.id) + (l.id === cfg.location ? ' (in use)' : '') + ', last 90 days: ' + ps.length + statusSummary_(ps));
    } catch (e) { lines.push('Could not read payments at ' + (l.name || l.id) + ': ' + e.message); }
  });
  ui.alert(lines.join('\n'));
}

// ---- Help and printing reports ----------------------------------------------
var START_SHEET = 'Start here';
var LISTS_SHEET = 'Lists';
var REPORT_SHEETS = { monthly: 'Monthly report', statement: 'Statements', outstanding: 'Outstanding payments' };
var PRINT_TITLES = { monthly: 'Print the monthly report', statement: 'Print a statement', outstanding: 'Print an outstanding payment' };

function openStartHere() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(START_SHEET);
  if (sh) ss.setActiveSheet(sh);
  else SpreadsheetApp.getUi().alert('The "' + START_SHEET + '" tab has gone missing. Ask whoever set up the sheet to restore it.');
}

function showPrintMonthly() { showPrintDialog_('monthly'); }
function showPrintStatement() { showPrintDialog_('statement'); }
function showPrintOutstanding() { showPrintDialog_('outstanding'); }

function showPrintDialog_(kind) {
  var t = HtmlService.createTemplateFromFile('Print');
  t.kind = kind;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(900).setHeight(760), PRINT_TITLES[kind]);
}

function namesOn_(ss, sheetName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  return sh.getRange(2, 1, LIST_ROWS - 1, 1).getValues()
    .map(function (r) { return String(r[0]).trim(); }).filter(String);
}

/** The choices for the print dialog's dropdowns, and what is currently chosen on the report tab. */
function getPrintOptions(kind) {
  if (!REPORT_SHEETS[kind]) throw new Error('Unknown report.');
  var ss = SpreadsheetApp.getActive();
  var lists = ss.getSheetByName(LISTS_SHEET), rep = ss.getSheetByName(REPORT_SHEETS[kind]);
  var months = lists ? lists.getRange('B2:B37').getDisplayValues().map(function (r) { return r[0]; }).filter(String) : [];
  var cur = {};
  if (rep) {
    if (kind === 'monthly') cur.month = rep.getRange('B3').getDisplayValue();
    else {
      cur.type = rep.getRange('B4').getDisplayValue();
      cur.name = rep.getRange('B5').getDisplayValue();
      if (kind === 'statement') cur.month = rep.getRange('B6').getDisplayValue();
    }
  }
  return { months: months, makers: namesOn_(ss, MAKERS), venues: namesOn_(ss, LOCATIONS), current: cur };
}

function setIfChanged_(range, value) {
  if (value !== undefined && value !== '' && range.getDisplayValue() !== value) range.setValue(value);
}

function whoFor_(ss, type, name) {
  var sh = ss.getSheetByName(type === 'Maker' ? MAKERS : LOCATIONS);
  var out = { type: type, name: name, email: '', phone: '', address: '' };
  if (!sh) return out;
  var rows = sh.getRange(2, 1, LIST_ROWS - 1, 6).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) {
      var r = rows[i];
      if (type === 'Maker') { out.email = r[2]; out.phone = r[3]; out.address = r[4]; }
      else { out.email = r[3]; out.phone = r[4]; out.address = r[5]; }
      break;
    }
  }
  return out;
}

function listBlock_(sh, firstRow, cols, maxRows) {
  var header = sh.getRange(firstRow - 1, 1, 1, cols).getDisplayValues()[0];
  var all = sh.getRange(firstRow, 1, maxRows, cols).getDisplayValues();
  var rows = [];
  for (var i = 0; i < all.length; i++) { if (String(all[i][0]).trim() === '') break; rows.push(all[i]); }
  return { header: header, rows: rows };
}

/**
 * Sets the report tab to the chosen month / maker / venue, then returns what it shows,
 * ready to draw as a clean printable page (no help notes).
 */
function getReportData(kind, sel) {
  if (!REPORT_SHEETS[kind]) throw new Error('Unknown report.');
  sel = sel || {};
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(REPORT_SHEETS[kind]);
  if (!sh) throw new Error('The "' + REPORT_SHEETS[kind] + '" tab is missing.');
  var generated = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'd MMMM yyyy');

  if (kind === 'monthly') {
    setIfChanged_(sh.getRange('B3'), sel.month);
  } else {
    var list = sel.type === 'Venue' ? namesOn_(ss, LOCATIONS) : namesOn_(ss, MAKERS);
    if (sel.name && list.indexOf(sel.name) < 0) {
      return { title: kind === 'statement' ? 'Statement' : 'Outstanding payment', period: '', generated: generated,
               error: 'Please choose a ' + String(sel.type || 'maker').toLowerCase() + ' from the list.' };
    }
    setIfChanged_(sh.getRange('B4'), sel.type);
    setIfChanged_(sh.getRange('B5'), sel.name);
    if (kind === 'statement') setIfChanged_(sh.getRange('B6'), sel.month);
  }
  SpreadsheetApp.flush();
  Utilities.sleep(500);            // give the formulas a moment to recalculate
  SpreadsheetApp.flush();

  if (kind === 'monthly') {
    var table = function (col, width) {
      var header = sh.getRange(17, col, 1, width).getDisplayValues()[0];
      var total = sh.getRange(18, col, 1, width).getDisplayValues()[0];
      var rows = sh.getRange(19, col, 100, width).getDisplayValues().filter(function (r) {
        return String(r[0]).trim() !== '' && String(r[1]).trim() !== '0';
      });
      return { header: header, total: total, rows: rows };
    };
    return {
      title: 'Monthly selling report', period: sh.getRange('B3').getDisplayValue(), generated: generated,
      totals: sh.getRange('A8:B15').getDisplayValues().filter(function (r) { return r[0] && String(r[0]).indexOf('Difference') !== 0; }),
      makers: table(1, 6), venues: table(8, 4)
    };
  }

  var lists = ss.getSheetByName(LISTS_SHEET);
  var ready = lists ? String(lists.getRange(kind === 'statement' ? 'H2' : 'I2').getDisplayValue()) === 'TRUE' : true;
  var type = sh.getRange('B4').getDisplayValue(), name = sh.getRange('B5').getDisplayValue();
  if (!ready) {
    return { title: kind === 'statement' ? 'Statement' : 'Outstanding payment', period: '', generated: generated,
             error: 'Please choose a ' + type.toLowerCase() + ' from the list.' };
  }
  var who = whoFor_(ss, type, name);

  if (kind === 'statement') {
    var blk = listBlock_(sh, 18, 7, 300);
    var none = blk.rows.length === 1 && String(blk.rows[0][0]).indexOf('No items sold') === 0;
    return {
      title: 'Statement', period: sh.getRange('B6').getDisplayValue(), generated: generated, who: who,
      summary: sh.getRange('A10:B15').getDisplayValues().filter(function (r) { return r[0]; }),
      items: { header: blk.header, rows: none ? [] : blk.rows, message: 'No items sold in this month.' }
    };
  }

  var blk2 = listBlock_(sh, 14, 5, 300);
  var nothing = blk2.rows.length === 1 && String(blk2.rows[0][0]).indexOf('Nothing outstanding') === 0;
  return {
    title: 'Outstanding payment', period: '', generated: generated, who: who,
    amount: sh.getRange('B7').getDisplayValue(), count: sh.getRange('B8').getDisplayValue(),
    items: { header: blk2.header, rows: nothing ? [] : blk2.rows, message: 'Nothing is outstanding.' }
  };
}

// ---- Mark as paid ------------------------------------------------------------
/**
 * Ticks "Maker paid?" (or "Venue paid?") for every item listed on the Outstanding payments tab,
 * for the maker or venue chosen there. Asks first, and checks every row belongs to that person.
 * Used by the menu item and by a button on the tab (assign this function to a drawing).
 */
function markShownAsPaid() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  var os = ss.getSheetByName(REPORT_SHEETS.outstanding), products = ss.getSheetByName(SHEET_NAME);
  if (!os || !products) { ui.alert('The Outstanding payments tab or the Products tab is missing.'); return; }

  var lists = ss.getSheetByName(LISTS_SHEET);
  var ready = lists ? String(lists.getRange('I2').getDisplayValue()) === 'TRUE' : true;
  var type = os.getRange('B4').getDisplayValue(), name = os.getRange('B5').getDisplayValue();
  if (!ready) { ui.alert('Please choose a maker or venue on the Outstanding payments tab first.'); return; }

  var blk = listBlock_(os, 14, 5, 300);
  if (!blk.rows.length || String(blk.rows[0][0]).indexOf('Nothing outstanding') === 0) {
    ui.alert('Nothing is outstanding for ' + name + '.');
    return;
  }
  var answer = ui.alert('Mark as paid',
    'Mark ' + blk.rows.length + ' item(s) for ' + name + ' (' + type.toLowerCase() + ') as PAID?\n\n' +
    'Amount: ' + os.getRange('B7').getDisplayValue() + '\n\n' +
    'Only do this once the payment has actually been made.', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  var col = type === 'Venue' ? COL.VENUE_PAID : COL.PAID;
  var whoCol = type === 'Venue' ? COL.LOCATION : COL.MAKER;
  var last = products.getLastRow();
  var data = last < 2 ? [] : products.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var byCode = {};
  data.forEach(function (r, i) { var c = String(r[COL.CODE - 1]).trim(); if (c && byCode[c] === undefined) byCode[c] = i; });

  var done = 0, skipped = [];
  blk.rows.forEach(function (r) {
    var code = String(r[0]).trim(), i = byCode[code];
    if (i === undefined) { skipped.push(code + ' (not found on the Products tab)'); return; }
    var row = data[i];
    if (String(row[whoCol - 1]).trim() !== name || row[COL.STATUS - 1] !== 'Sold') { skipped.push(code + ' (does not match ' + name + ')'); return; }
    products.getRange(i + 2, col).setValue(true);
    done++;
  });
  flush_();
  ui.alert(done + ' item(s) marked as paid for ' + name + '.' +
    (skipped.length ? '\n\nNot changed:\n' + skipped.join('\n') : '') +
    '\n\nThe Outstanding payments tab now shows what is left.');
}

// ---- Labels ----------------------------------------------------------------
function showLabelDialog() {
  var t = HtmlService.createTemplateFromFile('Labels');
  var html = t.evaluate().setWidth(900).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Print tags');
}

/** Rows to print: the selected rows, or every Listed row if nothing is selected. */
function getLabelRows() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var selected = sheetSelectionRows_(sh);
  var out = [];
  data.forEach(function (r, i) {
    var rowNum = i + 2;
    var url = String(r[COL.URL - 1]);
    if (url.indexOf('http') !== 0) return;
    if (selected && !selected[rowNum]) return;
    if (!selected && r[COL.STATUS - 1] !== 'Listed') return;
    var p = toPence(r[COL.PRICE - 1]);
    out.push({
      row: rowNum,
      code: String(r[COL.CODE - 1]),
      desc: String(r[COL.DESC - 1]),
      maker: String(r[COL.MAKER - 1]),
      price: p ? '£' + (p / 100).toFixed(2) : '',
      url: url
    });
  });
  return out;
}

function sheetSelectionRows_(sh) {
  var list = SpreadsheetApp.getActive().getActiveRangeList();
  if (!list) return null;
  var rows = {}, count = 0;
  list.getRanges().forEach(function (rg) {
    if (rg.getSheet().getName() !== SHEET_NAME) return;
    for (var r = rg.getRow(); r < rg.getRow() + rg.getNumRows(); r++) { if (r > 1) { rows[r] = true; count++; } }
  });
  // A single selected cell counts as "nothing selected" so the default (all Listed rows) applies.
  return count > 1 ? rows : null;
}

var TAG_DEFAULTS = {
  width: 45, height: 65, copies: 1,        // tag size in mm
  taper: 10, tip: 18,                      // depth of the sloping top corners, and the width of the flat tip, in mm
  gap: 3, margin: 10,                      // space between tags, and around the page, in mm
  outline: true, mark: true                // print the cut outline and the hole marker
};

/** Saved tag settings for this user, with defaults filled in. */
function getLabelSettings() {
  var saved = {};
  try { saved = JSON.parse(PropertiesService.getUserProperties().getProperty('TAG_SETTINGS') || '{}'); } catch (e) { saved = {}; }
  var out = {};
  Object.keys(TAG_DEFAULTS).forEach(function (k) {
    var v = saved[k];
    var isBool = typeof TAG_DEFAULTS[k] === 'boolean';
    out[k] = isBool ? (typeof v === 'boolean' ? v : TAG_DEFAULTS[k])
                    : (typeof v === 'number' && isFinite(v) && v >= 0 ? v : TAG_DEFAULTS[k]);
  });
  return out;
}

function saveLabelSettings(s) {
  var clean = {};
  Object.keys(TAG_DEFAULTS).forEach(function (k) {
    if (typeof TAG_DEFAULTS[k] === 'boolean') clean[k] = !!s[k];
    else if (typeof s[k] === 'number' && isFinite(s[k])) clean[k] = s[k];
  });
  PropertiesService.getUserProperties().setProperty('TAG_SETTINGS', JSON.stringify(clean));
}
