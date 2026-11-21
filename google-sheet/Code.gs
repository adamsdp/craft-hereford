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
var CURRENCY = 'GBP';
var SQUARE_VERSION = '2025-10-16';
var CODE_PREFIX = 'CH-';
var HEADERS = [
  'Item code', 'Product description', 'Maker', 'Price (GBP)', 'Cabinet / cafe',
  'Status', 'Square link URL', 'Square link ID', 'Date listed', 'Sold date', 'Maker paid?'
];
var COL = {
  CODE: 1, DESC: 2, MAKER: 3, PRICE: 4, CAFE: 5, STATUS: 6,
  URL: 7, LINK_ID: 8, LISTED: 9, SOLD: 10, PAID: 11
};

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

function setupSheet() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(2, COL.STATUS, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Draft', 'Listed', 'Sold'], true).build());
  sh.getRange(2, COL.PRICE, 500, 1).setNumberFormat('"£"0.00');
  sh.setColumnWidth(COL.DESC, 260);
  sh.setColumnWidth(COL.URL, 220);
  sh.getRange(2, COL.LINK_ID, 500, 1).setFontColor('#888888');
  SpreadsheetApp.getUi().alert('Sheet ready. Add products from row 2, leaving Status as Draft or blank.');
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

function nextCode_(existingCodes) {
  var max = 0;
  existingCodes.forEach(function (c) {
    var m = String(c).match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return CODE_PREFIX + ('0000' + (max + 1)).slice(-4);
}

function buildPaymentLinkBody(row, locationId, idempotencyKey) {
  return {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name: linkName(row.code, row.desc, row.maker),
      price_money: { amount: row.pence, currency: CURRENCY },
      location_id: locationId
    },
    payment_note: row.code + ' | ' + row.maker + ' | ' + row.desc
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

  var made = 0, problems = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var rowNum = i + 2;
    if (r[COL.URL - 1] || !String(r[COL.DESC - 1]).trim()) continue; // already has link / empty row

    var pence = toPence(r[COL.PRICE - 1]);
    if (!pence) { problems.push('Row ' + rowNum + ': missing or invalid price'); continue; }
    if (!String(r[COL.MAKER - 1]).trim()) { problems.push('Row ' + rowNum + ': missing maker'); continue; }

    var code = String(r[COL.CODE - 1]).trim();
    if (!code) { code = nextCode_(codes); codes.push(code); }

    var body = buildPaymentLinkBody({
      code: code,
      desc: String(r[COL.DESC - 1]).trim(),
      maker: String(r[COL.MAKER - 1]).trim(),
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
