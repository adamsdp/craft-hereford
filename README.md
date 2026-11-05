# Craft Hereford website

A simple, customer-facing website for **Craft Hereford**, a volunteer-run community group supporting local crafters, with display cabinets in independent coffee shops across Herefordshire.

It's plain HTML and CSS: no build step and nothing to install.

```
index.html          the page
styles.css          colours, fonts and layout
assets/             logo, favicon and app icon
```

## Putting it online (GitHub Pages, free)

1. On GitHub, open the repository and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Choose the branch this site is on (e.g. `main`) and the `/ (root)` folder, then **Save**.
4. After a minute or two the site will be live at `https://<your-username>.github.io/craft-hereford/`.

To use your own domain (e.g. `crafthereford.co.uk`), add it under **Settings → Pages → Custom domain** and follow GitHub's DNS instructions.

## Things to fill in

Search `index.html` for these:

- **Instagram and Facebook links**: in the *Say hello* section (marked `TODO`), replace `https://www.instagram.com/` and `https://www.facebook.com/` with your page addresses.
- **Cabinet locations**: in the *Find a cabinet* section there's a commented template. Copy it once for each host café and remove the "coming soon" card.
- **Contact for makers and cafés**: the *Get in touch* and *Host a cabinet* buttons currently scroll to the social links. If you want them to open an email instead, change their `href` to `mailto:your@email.address`.

## Editing tips

- Every change you commit to the branch updates the live site automatically within a minute or two.
- You can edit files directly on GitHub: open the file, click the pencil icon, make your change, then **Commit changes**.
