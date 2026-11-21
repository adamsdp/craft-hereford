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
var MAX_ROWS = 500;          // rows pre-filled with formulas and dropdowns on Products
var LIST_ROWS = 1000;        // rows covered by the Makers / Locations dropdown ranges

var HEADERS = [
  'Item code', 'Product description', 'Maker', 'Location', 'Price (GBP)',
  'Venue commission %', 'Selling commission %', 'Status',
  'Square link URL', 'Square link ID', 'Date listed', 'Sold date',
  'Venue commission (GBP)', 'Craft Hereford commission (GBP)', 'Maker receives (GBP)', 'Maker paid?'
];
var COL = {
  CODE: 1, DESC: 2, MAKER: 3, LOCATION: 4, PRICE: 5,
  VENUE_PCT: 6, SELL_PCT: 7, STATUS: 8,
  URL: 9, LINK_ID: 10, LISTED: 11, SOLD: 12,
  VENUE_GBP: 13, SELL_GBP: 14, MAKER_GBP: 15, PAID: 16
};
var MAKER_HEADERS = ['Name', 'Code', 'Email', 'Phone', 'Address'];
var LOCATION_HEADERS = ['Name', 'Venue commission %', 'Code', 'Email', 'Phone', 'Address'];

// Settings tab cells
var SET_VENUE_DEFAULT = 'B2';
var SET_SELL_DEFAULT = 'B3';
var SET_CHOICES_FIRST_ROW = 6;   // selling-commission choices are listed from A6 down

// ---- Menu ------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Craft Hereford')
    .addItem('1. Create Square links for new rows', 'createLinks')
    .addItem('2. Print labels...', 'showLabelDialog')
    .addItem('3. Switch off links for sold items', 'disableSoldLinks')
    .addSeparator()
    .addItem('Set up sheet (first time)', 'setupSheet')
    .addItem('Connect to Square...', 'connectSquare')
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

  // Formats
  sh.getRange(2, COL.PRICE, n, 1).setNumberFormat('"£"0.00');
  sh.getRange(2, COL.VENUE_PCT, n, 2).setNumberFormat('0.0%');
  sh.getRange(2, COL.VENUE_GBP, n, 3).setNumberFormat('"£"0.00');
  sh.getRange(2, COL.LISTED, n, 2).setNumberFormat('dd mmm yyyy');
  sh.getRange(2, COL.VENUE_PCT, n, 1).setFontColor('#555555');          // set by the location
  sh.getRange(2, COL.LINK_ID, n, 1).setFontColor('#888888');
  sh.getRange(2, COL.VENUE_GBP, n, 3).setBackground('#f3f3f3');         // calculated
  sh.getRange(1, COL.VENUE_GBP, 1, 3).setBackground('#e0e0e0');

  var widths = [80, 260, 150, 150, 80, 90, 90, 70, 220, 120, 90, 90, 100, 120, 100, 80];
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
    'Paste the access token from the Square Developer Dashboard (matching the environment above).',
    ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) return;

  var loc = ui.prompt('Square location ID',
    'Paste your Location ID (Developer Dashboard -> Locations).', ui.ButtonSet.OK_CANCEL);
  if (loc.getSelectedButton() !== ui.Button.OK) return;

  props.setProperties({
    SQUARE_ENV: envText,
    SQUARE_TOKEN: token.getResponseText().trim(),
    SQUARE_LOCATION: loc.getResponseText().trim()
  });
  ui.alert('Saved. Environment: ' + envText + '.');
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
  return {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name: linkName(row.code, row.desc, row.maker),
      price_money: { amount: row.pence, currency: CURRENCY },
      location_id: locationId
    },
    payment_note: row.code + ' | ' + row.maker + ' | ' + (row.location || '') + ' | ' + row.desc
  };
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

  var made = 0, problems = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var rowNum = i + 2;
    if (r[COL.URL - 1] || !String(r[COL.DESC - 1]).trim()) continue; // already has link / empty row

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

    var res = UrlFetchApp.fetch(cfg.base + '/v2/online-checkout/payment-links', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Square-Version': SQUARE_VERSION },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300 || !json.payment_link) {
      var msg = json.errors && json.errors[0] ? json.errors[0].detail || json.errors[0].code : 'HTTP ' + res.getResponseCode();
      problems.push('Row ' + rowNum + ': Square said: ' + msg);
      continue;
    }

    sh.getRange(rowNum, COL.CODE).setValue(code);
    sh.getRange(rowNum, COL.URL).setValue(json.payment_link.url);
    sh.getRange(rowNum, COL.LINK_ID).setValue(json.payment_link.id);
    sh.getRange(rowNum, COL.LISTED).setValue(new Date());
    sh.getRange(rowNum, COL.STATUS).setValue('Listed');
    made++;
  }

  var summary = made + ' link(s) created in ' + cfg.env + ' mode.';
  if (problems.length) summary += '\n\nSkipped:\n' + problems.join('\n');
  ui.alert(summary);
}

// ---- Switch off links for sold items --------------------------------------
function disableSoldLinks() {
  var ui = SpreadsheetApp.getUi();
  var cfg = squareConfig_();
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  var last = sh.getLastRow();
  if (last < 2) return;
  var data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();

  var done = 0, problems = [];
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
      done++;
    } else {
      problems.push('Row ' + (i + 2) + ': HTTP ' + res.getResponseCode());
    }
  });
  ui.alert(done + ' link(s) switched off.' + (problems.length ? '\n\n' + problems.join('\n') : ''));
}

// ---- Labels ----------------------------------------------------------------
function showLabelDialog() {
  var t = HtmlService.createTemplateFromFile('Labels');
  var html = t.evaluate().setWidth(900).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'Print labels');
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

function getLabelSettings() {
  var p = PropertiesService.getUserProperties().getProperties();
  return { width: Number(p.LABEL_W) || 62, height: Number(p.LABEL_H) || 29, copies: Number(p.LABEL_COPIES) || 1 };
}

function saveLabelSettings(s) {
  PropertiesService.getUserProperties().setProperties({
    LABEL_W: String(s.width), LABEL_H: String(s.height), LABEL_COPIES: String(s.copies)
  });
}
