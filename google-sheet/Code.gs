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
  SpreadsheetApp.getUi().createMenu('Craft Hereford')
    .addItem('1. Create Square links for new rows', 'createLinks')
    .addItem('2. Print tags...', 'showLabelDialog')
    .addItem('3. Sync sales from Square', 'syncSales')
    .addItem('4. Switch off links for sold items', 'disableSoldLinks')
    .addSeparator()
    .addItem('Set up sheet (first time)', 'setupSheet')
    .addItem('Connect to Square...', 'connectSquare')
    .addItem('Check Square connection', 'checkSquare')
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

function productsEdited_(sh, rg) {
  var first = Math.max(rg.getRow(), 2);
  var last = Math.min(rg.getRow() + rg.getNumRows() - 1, MAX_ROWS + 1);
  var sellDefault = settingNumber_(SET_SELL_DEFAULT, 0.10);
  var lookups = null, existing = null;
  for (var r = first; r <= last; r++) {
    // New product: fill the default selling commission.
    var hasDesc = String(sh.getRange(r, COL.DESC).getValue()).trim() !== '';
    var sell = sh.getRange(r, COL.SELL_PCT);
    if (hasDesc && sell.getValue() === '') sell.setValue(sellDefault);

    // Both maker and location chosen: give the item its code (fixed once set).
    var codeCell = sh.getRange(r, COL.CODE);
    var maker = sh.getRange(r, COL.MAKER).getValue(), loc = sh.getRange(r, COL.LOCATION).getValue();
    if (String(codeCell.getValue()).trim() === '' && maker !== '' && loc !== '') {
      if (!lookups) {
        lookups = codeLookups_();
        existing = sh.getRange(2, COL.CODE, MAX_ROWS, 1).getValues().map(function (x) { return x[0]; });
      }
      var newCode = itemCodeFor_(lookups, maker, loc, existing);
      if (newCode) codeCell.setValue(newCode);
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

  var summary = made + ' link(s) created in ' + cfg.env + ' mode.';
  if (walletsRefused) summary += '\n\nNote: Square would not accept the Apple Pay / Google Pay setting for ' + walletsRefused + ' link(s), so those links were made without it.';
  if (problems.length) summary += '\n\nSkipped:\n' + problems.join('\n');
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

  var msg = 'Synced with Square (' + cfg.env + '), payments since ' + begin.toISOString().slice(0, 10) + '.\n\n' +
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
