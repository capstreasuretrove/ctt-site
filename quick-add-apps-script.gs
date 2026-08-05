/**
 * CTT Quick Add — Apps Script Web App handler
 *
 * SETUP:
 * 1. Open the Inventory Google Sheet (1zSd87OlxqrWOzEjPd6TAm4MYn57fhrccdmd4xYwvtXA)
 * 2. Extensions → Apps Script → paste this into a new file (or add doPost routing
 *    to your existing script if this sheet already has one).
 * 3. Check SHEET_NAME below matches the actual In Stock tab name.
 * 4. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone.
 * 5. Copy the Web App URL into SCRIPT_URL at the top of ctt-quick-add.html.
 */

var SHEET_NAME = "In Stock";   // <-- confirm this matches the tab name exactly
var HEADER_ROWS = 2;           // row 1 = merged title, row 2 = column headers; data starts row 3

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.action === "addInventoryItems") {
      return addInventoryItems(payload.items || []);
    }
    return jsonOut({ ok: false, error: "Unknown action: " + payload.action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function addInventoryItems(items) {
  if (!items.length) return jsonOut({ ok: false, error: "No items provided" });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return jsonOut({ ok: false, error: "Sheet tab not found: " + SHEET_NAME });

  // Sheet column order:
  // Name | Number | Line | License | Qty | Owner | Date Added | Ebay Listed? | Size | Chase? | Piece Count | Featured
  var rows = items.map(function (it) {
    return [
      it.name || "",
      it.number || "",
      it.line || "",
      it.license || "",
      it.qty || 1,
      it.owner || "BL",
      it.dateAdded || "",
      it.ebayListed === true,
      it.size || "",
      it.chase || "",
      it.pieceCount || "",
      it.featured === true
    ];
  });

  // Newest items live at the top of the sheet: insert blank rows right under
  // the headers, then write the batch there.
  sheet.insertRowsBefore(HEADER_ROWS + 1, rows.length);
  var range = sheet.getRange(HEADER_ROWS + 1, 1, rows.length, rows[0].length);
  range.setValues(rows);

  // Force Date Added (col 7) and Number (col 2) to plain text so Sheets doesn't
  // coerce "2026-08-05" into a Date or mangle values like "2PK".
  sheet.getRange(HEADER_ROWS + 1, 2, rows.length, 1).setNumberFormat("@");
  sheet.getRange(HEADER_ROWS + 1, 7, rows.length, 1).setNumberFormat("@");
  // Re-write those two columns as strings after formatting
  var numVals  = rows.map(function (r) { return [String(r[1])]; });
  var dateVals = rows.map(function (r) { return [String(r[6])]; });
  sheet.getRange(HEADER_ROWS + 1, 2, rows.length, 1).setValues(numVals);
  sheet.getRange(HEADER_ROWS + 1, 7, rows.length, 1).setValues(dateVals);

  return jsonOut({ ok: true, added: rows.length });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
