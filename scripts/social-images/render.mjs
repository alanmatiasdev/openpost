export const socialRendererVersion = 3;

const WIDTH = 1200;
const HEIGHT = 630;

const light = {
  canvas: "#fbfaf7",
  surface: "#ffffff",
  surfaceAlt: "#f2efea",
  ink: "#2c2825",
  muted: "#786f68",
  border: "#e3ded7",
  orange: "#bd5b2b",
  orangeSoft: "#f0c9ad",
  orangePale: "#f8e5d6",
  dark: "#1a1512",
};

const dark = {
  canvas: "#1a1512",
  surface: "#28211d",
  surfaceAlt: "#332a25",
  ink: "#eee9e3",
  muted: "#aaa097",
  border: "#453a33",
  orange: "#d06a35",
  orangeSoft: "#8f4828",
  orangePale: "#4d3024",
  dark: "#0f0c0a",
};

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapWords(value, maxCharacters, maxLines) {
  const words = String(value).trim().split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }

  if (line && lines.length < maxLines) {
    const consumed = lines.length ? lines.join(" ").split(/\s+/).length : 0;
    const remaining = words.slice(consumed).join(" ");
    lines.push(remaining.length > maxCharacters + 6 ? `${remaining.slice(0, maxCharacters).trim()}…` : remaining);
  }

  return lines.slice(0, maxLines);
}

function textLines({ lines, x, y, size, lineHeight, fill, weight = 650, letterSpacing = -1.4 }) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Geist" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}">${lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("")}</text>`;
}

export function brandMark({ x, y, scale = 0.19, color }) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <defs>
      <mask id="nib-cutout-${x}-${y}">
        <rect x="-50" y="-20" width="100" height="150" fill="white" />
        <circle cx="0" cy="35" r="5" fill="black" />
        <rect x="-1.5" y="35" width="3" height="70" fill="black" />
      </mask>
    </defs>
    <g transform="translate(160 180) rotate(-40)">
      <path d="M -30 -170 A 30 30 0 0 1 30 -170 L 22 -10 L -22 -10 Z" fill="${color}" />
      <path d="M -20 0 L 20 0 L 28 35 L 0 100 L -28 35 Z" fill="${color}" mask="url(#nib-cutout-${x}-${y})" />
    </g>
    <path d="M 235 280 C 250 290, 265 230, 275 230 C 285 230, 290 275, 300 275 C 310 275, 325 160, 340 160 C 355 160, 365 290, 380 290 C 395 290, 400 170, 415 170" fill="none" stroke="${color}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" />
  </g>`;
}

function brandLockup(colors) {
  return `${brandMark({ x: 62, y: 37, scale: 0.15, color: colors.ink })}
    <text x="128" y="87" fill="${colors.ink}" font-family="Geist" font-size="28" font-weight="680" letter-spacing="-0.7">OpenPost</text>`;
}

function activityGrid(colors, { x = 770, y = 190, columns = 12, rows = 7, size = 21, gap = 9 } = {}) {
  const levels = [colors.surfaceAlt, colors.orangePale, colors.orangeSoft, colors.orange];
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const score = (column * 7 + row * 11 + column * row) % 15;
      const level = score > 12 ? 3 : score > 9 ? 2 : score > 5 ? 1 : 0;
      cells.push(
        `<rect x="${x + column * (size + gap)}" y="${y + row * (size + gap)}" width="${size}" height="${size}" rx="5" fill="${levels[level]}" />`,
      );
    }
  }
  return cells.join("");
}

function chip(colors, x, y, label, active = false) {
  const width = Math.max(112, label.length * 8.2 + 44);
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="46" rx="12" fill="${active ? colors.orangePale : colors.surface}" stroke="${active ? colors.orangeSoft : colors.border}" />
    <rect x="${x + 16}" y="${y + 18}" width="10" height="10" rx="3" fill="${active ? colors.orange : colors.muted}" />
    <text x="${x + 36}" y="${y + 29}" fill="${colors.ink}" font-family="Geist" font-size="16" font-weight="620">${escapeXml(label)}</text>
  </g>`;
}

function homeMotif(colors, assets) {
  if (!assets.screenshotHref) return workflowMotif(colors);
  return `<g>
    <path d="M 718 138 C 778 112 830 118 886 142 C 940 166 1003 148 1136 90" fill="none" stroke="${colors.orange}" stroke-width="4" stroke-linecap="round" />
    <rect x="698" y="142" width="458" height="348" rx="24" fill="${colors.dark}" />
    <rect x="714" y="158" width="426" height="316" rx="15" fill="${colors.dark}" stroke="${colors.border}" />
    <clipPath id="home-shot"><rect x="714" y="158" width="426" height="316" rx="15" /></clipPath>
    <image href="${escapeXml(assets.screenshotHref)}" x="714" y="158" width="506" height="316" preserveAspectRatio="xMinYMid slice" clip-path="url(#home-shot)" />
    <rect x="676" y="438" width="158" height="48" rx="12" fill="${colors.surface}" stroke="${colors.border}" />
    <rect x="694" y="457" width="10" height="10" rx="3" fill="${colors.orange}" />
    <text x="716" y="469" fill="${colors.ink}" font-family="Geist" font-size="16" font-weight="620">Publish</text>
  </g>`;
}

function workflowMotif(colors) {
  return `<g>
    <rect x="704" y="146" width="444" height="348" rx="24" fill="${colors.surface}" stroke="${colors.border}" />
    <text x="740" y="194" fill="${colors.muted}" font-family="Geist Mono" font-size="13" font-weight="600" letter-spacing="1.2">ONE CONTENT SYSTEM</text>
    ${activityGrid(colors, { x: 742, y: 224, columns: 11, rows: 6, size: 20, gap: 9 })}
    <path d="M 748 432 C 810 398 844 458 904 424 C 963 390 1005 451 1087 407" fill="none" stroke="${colors.orange}" stroke-width="4" stroke-linecap="round" />
    <circle cx="748" cy="432" r="7" fill="${colors.orange}" />
    <circle cx="1087" cy="407" r="7" fill="${colors.orange}" />
  </g>`;
}

function platformsMotif(colors, assets) {
  const icons = assets.platformIcons ?? [];
  return `<g>
    <rect x="714" y="142" width="438" height="358" rx="24" fill="${colors.surface}" stroke="${colors.border}" />
    ${icons.slice(0, 10).map((href, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      const x = 748 + column * 77;
      const y = 188 + row * 112;
      return `<g><rect x="${x}" y="${y}" width="58" height="58" rx="16" fill="${colors.surfaceAlt}" /><image href="${escapeXml(href)}" x="${x + 15}" y="${y + 15}" width="28" height="28" preserveAspectRatio="xMidYMid meet" /><rect x="${x + 19}" y="${y + 76}" width="20" height="6" rx="3" fill="${index % 3 === 0 ? colors.orange : colors.border}" /></g>`;
    }).join("")}
    <path d="M 766 420 C 834 386 904 458 1096 401" fill="none" stroke="${colors.orange}" stroke-width="4" stroke-linecap="round" />
  </g>`;
}

function platformMotif(colors, entry, assets) {
  const href = assets.platformIconHref;
  return `<g>
    <rect x="748" y="128" width="336" height="336" rx="30" fill="${colors.surface}" stroke="${colors.border}" />
    <rect x="826" y="176" width="180" height="180" rx="42" fill="${colors.surfaceAlt}" />
    ${href ? `<image href="${escapeXml(href)}" x="878" y="228" width="76" height="76" preserveAspectRatio="xMidYMid meet" />` : ""}
    ${chip(colors, 680, 404, "Draft", false)}
    ${chip(colors, 864, 428, "Publish", true)}
    <path d="M 791 394 C 854 356 913 408 1014 376" fill="none" stroke="${colors.orange}" stroke-width="4" stroke-linecap="round" />
    <text x="916" y="389" fill="${colors.muted}" font-family="Geist" font-size="14" text-anchor="middle">${escapeXml(entry.subject ?? "Destination")}</text>
  </g>`;
}

function comparisonMotif(colors, entry) {
  return `<g>
    <rect x="694" y="154" width="204" height="292" rx="22" fill="${colors.dark}" />
    ${brandMark({ x: 722, y: 184, scale: 0.28, color: "#f5efe9" })}
    <text x="796" y="397" fill="#f5efe9" font-family="Geist" font-size="24" font-weight="680" text-anchor="middle">OpenPost</text>
    <rect x="944" y="154" width="204" height="292" rx="22" fill="${colors.surface}" stroke="${colors.border}" />
    <text x="1046" y="286" fill="${colors.ink}" font-family="Geist" font-size="30" font-weight="680" text-anchor="middle">${escapeXml(entry.subject ?? "Another tool")}</text>
    <text x="1046" y="324" fill="${colors.muted}" font-family="Geist" font-size="14" text-anchor="middle">reviewed facts</text>
    <circle cx="921" cy="300" r="34" fill="${colors.orange}" />
    <text x="921" y="308" fill="#fff8f3" font-family="Geist Mono" font-size="18" font-weight="700" text-anchor="middle">VS</text>
  </g>`;
}

function toolMotif(colors, entry) {
  return `<g>
    <rect x="698" y="142" width="452" height="352" rx="24" fill="${colors.surface}" stroke="${colors.border}" />
    <rect x="698" y="142" width="452" height="52" rx="24" fill="${colors.surfaceAlt}" />
    <circle cx="731" cy="168" r="6" fill="${colors.orange}" /><circle cx="753" cy="168" r="6" fill="${colors.border}" /><circle cx="775" cy="168" r="6" fill="${colors.border}" />
    <rect x="736" y="236" width="250" height="18" rx="9" fill="${colors.border}" />
    <rect x="736" y="270" width="322" height="14" rx="7" fill="${colors.surfaceAlt}" />
    <rect x="736" y="298" width="278" height="14" rx="7" fill="${colors.surfaceAlt}" />
    <rect x="736" y="364" width="146" height="48" rx="12" fill="${colors.orange}" />
    <text x="809" y="394" fill="#fff8f3" font-family="Geist" font-size="16" font-weight="650" text-anchor="middle">Use the tool</text>
    <text x="736" y="452" fill="${colors.muted}" font-family="Geist" font-size="14">${escapeXml((entry.subject ?? "Free browser tool").slice(0, 42))}</text>
  </g>`;
}

function securityMotif(colors) {
  return `<g>
    <rect x="762" y="198" width="306" height="246" rx="30" fill="${colors.surface}" stroke="${colors.border}" />
    <path d="M 837 242 V 216 C 837 164 993 164 993 216 V 242" fill="none" stroke="${colors.ink}" stroke-width="22" stroke-linecap="round" />
    <rect x="814" y="236" width="202" height="160" rx="24" fill="${colors.dark}" />
    <circle cx="915" cy="308" r="19" fill="${colors.orange}" />
    <rect x="908" y="324" width="14" height="34" rx="7" fill="${colors.orange}" />
    ${chip(colors, 706, 430, "Encrypted", true)}
    ${chip(colors, 930, 454, "Scoped access", false)}
  </g>`;
}

function openSourceMotif(colors) {
  return `<g>
    <rect x="704" y="146" width="444" height="348" rx="24" fill="${colors.dark}" />
    <text x="744" y="208" fill="#c7bdb4" font-family="Geist Mono" font-size="17">$ openpost serve</text>
    <text x="744" y="250" fill="#f3eee8" font-family="Geist Mono" font-size="17">ready :8080</text>
    <path d="M 780 304 L 742 338 L 780 372" fill="none" stroke="${colors.orange}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 1070 304 L 1108 338 L 1070 372" fill="none" stroke="${colors.orange}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M 826 396 L 1008 280" fill="none" stroke="#f3eee8" stroke-width="8" stroke-linecap="round" />
    <text x="744" y="454" fill="#8f837a" font-family="Geist Mono" font-size="14">one service · SQLite by default</text>
  </g>`;
}

function documentMotif(colors) {
  return `<g>
    <rect x="770" y="126" width="290" height="382" rx="22" fill="${colors.surface}" stroke="${colors.border}" />
    <rect x="810" y="182" width="170" height="16" rx="8" fill="${colors.orange}" />
    <rect x="810" y="232" width="206" height="12" rx="6" fill="${colors.border}" />
    <rect x="810" y="260" width="176" height="12" rx="6" fill="${colors.border}" />
    <rect x="810" y="288" width="194" height="12" rx="6" fill="${colors.border}" />
    <rect x="810" y="350" width="46" height="46" rx="10" fill="${colors.orangePale}" />
    <rect x="874" y="350" width="46" height="46" rx="10" fill="${colors.orangeSoft}" />
    <rect x="938" y="350" width="46" height="46" rx="10" fill="${colors.orange}" />
  </g>`;
}

function motifFor(entry, colors, assets) {
  switch (entry.kind) {
    case "home":
      return homeMotif(colors, assets);
    case "platforms":
      return platformsMotif(colors, assets);
    case "platform":
      return platformMotif(colors, entry, assets);
    case "comparison":
    case "compare-index":
      return entry.kind === "comparison" ? comparisonMotif(colors, entry) : workflowMotif(colors);
    case "tool":
    case "tools-index":
      return entry.kind === "tool" ? toolMotif(colors, entry) : workflowMotif(colors);
    case "security":
      return securityMotif(colors);
    case "open-source":
      return openSourceMotif(colors);
    case "document":
    case "docs":
      return documentMotif(colors);
    default:
      return workflowMotif(colors);
  }
}

export function renderSocialImageSvg(entry, assets = {}, options = {}) {
  const colors = options.theme === "dark" ? dark : light;
  const titleLines = wrapWords(entry.socialTitle, entry.kind === "tool" ? 19 : 25, 3);
  const descriptionLines = wrapWords(entry.description, 51, 3);
  const titleSize = titleLines.length > 2 ? 50 : 56;
  const titleLineHeight = titleSize + 4;
  const descriptionY = 214 + titleLines.length * titleLineHeight;
  const fontFace = assets.fontData
    ? `@font-face{font-family:Geist;src:url(data:font/woff2;base64,${assets.fontData}) format('woff2');font-weight:100 900;font-style:normal;font-display:block;}`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <style>${fontFace} text{font-kerning:normal;text-rendering:geometricPrecision}</style>
    <rect width="1200" height="630" fill="${colors.canvas}" />
    <rect x="0" y="0" width="18" height="630" fill="${colors.orange}" />
    <path d="M 18 552 H 1200" stroke="${colors.border}" />
    ${brandLockup(colors)}
    <rect x="72" y="137" width="9" height="9" rx="3" fill="${colors.orange}" />
    <text x="95" y="148" fill="${colors.orange}" font-family="Geist Mono, ui-monospace" font-size="14" font-weight="700" letter-spacing="1.5">${escapeXml(entry.label.toUpperCase())}</text>
    ${textLines({ lines: titleLines, x: 72, y: 214, size: titleSize, lineHeight: titleLineHeight, fill: colors.ink })}
    ${textLines({ lines: descriptionLines, x: 74, y: descriptionY + 22, size: 21, lineHeight: 30, fill: colors.muted, weight: 450, letterSpacing: -0.2 })}
    ${motifFor(entry, colors, assets)}
    <text x="72" y="590" fill="${colors.muted}" font-family="Geist" font-size="17">${escapeXml(entry.canonical.replace(/^https?:\/\//, ""))}</text>
    <g transform="translate(1002 571)">${activityGrid(colors, { x: 0, y: 0, columns: 6, rows: 1, size: 12, gap: 8 })}</g>
  </svg>`;
}
