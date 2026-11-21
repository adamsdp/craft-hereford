# Selling cabinet items with Square QR codes

> **Prefer to enter products in a Google Sheet and print labels automatically?** See [google-sheet-labels.md](google-sheet-labels.md). This page covers the manual, Dashboard-only route.

How to give each item in a cabinet its own QR code. A customer scans it, pays on their phone, and the money goes to Craft Hereford's Square account. No website changes are needed: Square hosts the checkout page.

> Menu names and fees below come from Square's UK help pages and may change. If a screen looks different, search Square's help for "Payment Links".

## 1. One-off setup

1. Sign up at [squareup.com/gb](https://squareup.com/gb) with a group email address (not a personal one).
2. Complete identity verification and link the group's bank account, so payouts go to the group rather than an individual.
3. In the Square Dashboard, check that **Payments → Payment links** is available. UK accounts charge in GBP.
4. Decide who gets to log in (Dashboard → Account & Settings → Team) so that more than one volunteer can make links.

**Fees (UK, check current rates):** about 1.4% + 25p per online payment for UK cards, 2.5% + 25p for non-UK cards, no monthly fee. The 25p matters on cheap items, so consider a minimum price of around £3, or sell small items as bundles.

## 2. Make a link for each item

1. In the Dashboard go to **Payments → Payment links → Create link**.
2. Choose **Sell an item** (shows a photo and name on checkout) or **Collect a payment** (a plain fixed amount).
3. Fill in:
   - **Name:** use the format `CH-0042 Maker Name: Item name` (see item codes below).
   - **Price** and an optional **photo**.
   - **Description:** include the cabinet location, so you know where to collect the item from.
4. Save. Then choose **Share → QR code** and download the image (or **Actions → Print QR Code** to save a PDF).
5. Name the file after the item code, e.g. `CH-0042.png`, and keep them in one shared folder.

### Item codes

Give every item a unique code (`CH-0001`, `CH-0002`, ...). Because the code is in the link name, it shows up on the Square receipt and in the Dashboard transaction list, which is how you work out what each maker is owed.

Keep a tracker with one row per item: see [`product-tracker-template.csv`](product-tracker-template.csv). Open it in Excel or Google Sheets.

## 3. Printing labels

- Print the QR code at **at least 2.5 cm square**, with a plain white margin around it.
- Put the item code and price in text next to the QR code, so volunteers and café staff can match a sale to an item.
- Add "Scan to pay · Craft Hereford" so people know what it is, plus a short line saying how they get the item (see below).
- Print a test and **scan it with two different phones** before you print the whole batch.

## 4. After a sale: handing over the item

Square cannot tell the café that something was bought, so choose one routine and print it on the label:

- **Show the receipt:** the customer shows the payment confirmation to café staff, who hand over the item. Quick, but staff need to be happy to do this and to know what a genuine confirmation looks like.
- **Collect from a volunteer:** the customer gets a receipt email and the volunteer arranges pickup. Safer, slower.
- **Daily check:** a volunteer checks Dashboard transactions, matches item codes in the tracker, and removes sold items from the cabinet.

## 5. One-of-a-kind items

A payment link stays live until you turn it off, so a second person could scan a label for an item that has already gone. When something sells:

1. Mark it **Sold** in the tracker.
2. Remove the label from the cabinet.
3. Deactivate or delete the link in **Payments → Payment links**.

If the item is a repeat product (cards, candles), a single reusable link is fine.

## 6. Paying makers

Once a month, filter the Dashboard's transactions by item code, fill in the tracker's **Sold date** and **Square payment ID** columns, and pay each maker the price minus Square's fee (and any group commission you agree). Refunds can be made from the Dashboard or the Square POS app.

## Tips and limits

- Payment links are for **domestic (UK) sales** only.
- If you end up with dozens of items, ask for help automating this. Square has an API that can create the links and QR codes in bulk from the tracker file.
- Keep a spreadsheet backup of the tracker; the Dashboard is not a stock system.
