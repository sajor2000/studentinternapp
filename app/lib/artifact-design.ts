export const chicagoHealthMapArtifactDesignPrompt = [
  "All Word, PowerPoint, HTML, and marimo-export artifact drafts must use Chicago Health Map branding from chicagohealthmap.com.",
  "Use the live Chicago Health Map visual system: white or near-white pages, editorial Georgia headings, clear sans-serif body/UI text, indigo navigation and buttons, lavender accents, stone-gray surfaces, bordered cards, and restrained shadows.",
  "Use this live-site palette: primary indigo #292190, deep indigo #1e1869, dark indigo #141046, lavender #dad8f6, page #fcfcfc, surface #f5f5f4, border #eaeaea, heading #1c1917, body text #44403c, muted text #78716c, map blue #98cee5, map cyan #8cc4e0, map lavender #918be4, map purple #6d64dc, and map teal #2d89b0.",
  "For data visualization, prefer Chicago Health Map map/chart colors: indigo and lavender for primary series, blue/cyan/teal for geography or neighborhood measures, and stone grays for comparison or background series. Keep chart backgrounds white, axes light, labels readable, and legends clear of data.",
  "Use Georgia for major artifact titles and section headings. Use Arial, Helvetica, or a similar sans-serif for navigation, labels, buttons, captions, tables, and body text.",
  "Use white cards on stone backgrounds, 1px light-gray borders, compact 8px radius, and subtle shadows only for raised cards or dialogs.",
  "For HTML artifacts, include a complete self-contained <style> block with these tokens, responsive layout rules, accessible contrast, printable behavior, and no external design assets.",
  "For PowerPoint artifacts, specify white dashboard slides with Chicago Health Map top navigation/header treatment, indigo buttons or section accents, Georgia titles, and live-site chart palettes.",
  "For Word artifacts, use the same identity through a Chicago Health Map document header, Georgia headings, indigo section accents, restrained tables, and live-site chart specifications.",
].join("\n");

export const chicagoHealthMapHtmlPreviewCss = `
  :root {
    color-scheme: light;
    --chm-primary: #292190;
    --chm-primary-deep: #1e1869;
    --chm-primary-dark: #141046;
    --chm-lavender: #dad8f6;
    --chm-page: #fcfcfc;
    --chm-surface: #f5f5f4;
    --chm-card: #ffffff;
    --chm-border: #eaeaea;
    --chm-heading: #1c1917;
    --chm-text: #44403c;
    --chm-muted: #78716c;
    --chm-map-blue: #98cee5;
    --chm-map-cyan: #8cc4e0;
    --chm-map-lavender: #918be4;
    --chm-map-purple: #6d64dc;
    --chm-map-teal: #2d89b0;
    --chm-shadow: 0 8px 22px rgba(28, 25, 23, 0.08);
  }

  html {
    background: var(--chm-page);
  }

  body {
    margin: 0;
    color: var(--chm-text);
    background: var(--chm-page);
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.5;
  }

  body:not([data-chicago-health-map-artifact]) {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 clamp(20px, 4vw, 56px) clamp(32px, 5vw, 72px);
  }

  body:not([data-chicago-health-map-artifact])::before {
    content: "Chicago Health Map";
    display: block;
    margin: 0 calc(clamp(20px, 4vw, 56px) * -1) clamp(28px, 4vw, 48px);
    padding: 18px clamp(20px, 4vw, 56px) 12px;
    color: var(--chm-primary);
    background: var(--chm-page);
    border-bottom: 2px solid var(--chm-primary);
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0;
  }

  body:not([data-chicago-health-map-artifact]) h1,
  body:not([data-chicago-health-map-artifact]) .artifact-title {
    max-width: 980px;
    margin: 0 0 24px;
    color: var(--chm-heading);
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(36px, 6vw, 72px);
    line-height: 1.06;
    font-weight: 500;
    letter-spacing: 0;
  }

  body:not([data-chicago-health-map-artifact]) h2,
  body:not([data-chicago-health-map-artifact]) h3 {
    color: var(--chm-heading);
    font-family: Georgia, "Times New Roman", serif;
    font-weight: 500;
    letter-spacing: 0;
  }

  body:not([data-chicago-health-map-artifact]) h2 {
    margin-top: 36px;
    padding: 0;
    background: transparent;
    font-size: 34px;
  }

  body:not([data-chicago-health-map-artifact]) h3 {
    font-size: 22px;
  }

  body:not([data-chicago-health-map-artifact]) p,
  body:not([data-chicago-health-map-artifact]) li,
  body:not([data-chicago-health-map-artifact]) td,
  body:not([data-chicago-health-map-artifact]) th {
    color: var(--chm-text);
  }

  body:not([data-chicago-health-map-artifact]) .label,
  body:not([data-chicago-health-map-artifact]) .eyebrow,
  body:not([data-chicago-health-map-artifact]) .badge {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    margin-bottom: 12px;
    padding: 6px 15px;
    border-radius: 999px;
    color: #ffffff;
    background: var(--chm-primary);
    font-size: 14px;
    font-weight: 700;
  }

  body:not([data-chicago-health-map-artifact]) section,
  body:not([data-chicago-health-map-artifact]) article,
  body:not([data-chicago-health-map-artifact]) .card {
    border: 1px solid var(--chm-border);
    border-radius: 8px;
    background: var(--chm-card);
  }

  body:not([data-chicago-health-map-artifact]) section,
  body:not([data-chicago-health-map-artifact]) article {
    margin: 18px 0;
    padding: 18px;
  }

  body:not([data-chicago-health-map-artifact]) .card {
    box-shadow: var(--chm-shadow);
  }

  body:not([data-chicago-health-map-artifact]) .muted,
  body:not([data-chicago-health-map-artifact]) small,
  body:not([data-chicago-health-map-artifact]) figcaption {
    color: var(--chm-muted);
  }

  body:not([data-chicago-health-map-artifact]) table {
    width: 100%;
    border-collapse: collapse;
    color: var(--chm-text);
  }

  body:not([data-chicago-health-map-artifact]) th {
    color: var(--chm-heading);
    text-align: left;
    background: var(--chm-surface);
  }

  body:not([data-chicago-health-map-artifact]) th,
  body:not([data-chicago-health-map-artifact]) td {
    border-bottom: 1px solid var(--chm-border);
    padding: 10px 8px;
  }

  body:not([data-chicago-health-map-artifact]) a {
    color: var(--chm-primary);
  }

  body:not([data-chicago-health-map-artifact]) .primary,
  body:not([data-chicago-health-map-artifact]) .chart-primary {
    color: var(--chm-primary);
  }

  body:not([data-chicago-health-map-artifact]) .secondary,
  body:not([data-chicago-health-map-artifact]) .chart-secondary {
    color: var(--chm-map-teal);
  }

  body:not([data-chicago-health-map-artifact]) .accent {
    color: var(--chm-map-purple);
  }

  @media print {
    body:not([data-chicago-health-map-artifact]) {
      max-width: none;
      padding: 0.5in;
    }

    body:not([data-chicago-health-map-artifact])::before {
      margin-inline: -0.5in;
      padding-inline: 0.5in;
    }
  }
`;
