/**
 * One other session's block on Desktop, drawn as a Client region so the whole block (name, bar, time) is one click target with one hover background.
 * A Button only takes a text label and an absolutely placed Box passes the pointer to its parent, so neither can make the drawn bar clickable; a Client region gets every pointer event itself.
 *
 * props: { name, glyph, light, right, pct (number | null), barColor, track, hoverBg, jumpingLabel }
 */
export default function SessionRow(p, surface) {
  const { Box, Text } = surface.elements
  const state = surface.state ?? {}
  const hover = state.hover === true
  const jumping = state.jumping === true
  const set = (change) => surface.setState({ ...state, ...change })
  // Tell the hooks module once that this region really runs: the desktop app can fail to start the region's runtime, and the pane then falls back to plain rows
  if (state.ready !== true) { surface.post({ ready: true }); set({ ready: true }) }
  // One listener; a later call replaces the earlier one, so setting it on every draw is safe
  surface.onPointer((e) => {
    if (e.type === 'enter' && !hover) set({ hover: true })
    else if (e.type === 'leave' && hover) set({ hover: false })
    // Jump on release inside the block, so pressing and dragging away cancels like a normal button.
    // The app takes a few seconds to switch, so the block answers at once, here, without waiting for the hooks module, and ignores more clicks meanwhile
    else if (e.type === 'up' && e.button === 'left' && isInside(e, surface) && surface.state?.jumping !== true) {
      surface.setState({ ...(surface.state ?? {}), jumping: true })
      surface.post({ jump: true })
      const stop = surface.every(JUMP_FEEDBACK_MS, () => { stop(); surface.setState({ ...(surface.state ?? {}), jumping: false }) })
    }
  })
  const right = jumping ? p.jumpingLabel : p.right
  const line1 = Box({ flexDirection: 'row', justifyContent: 'space-between', columnGap: 1, children: [
    Box({ flexDirection: 'row', columnGap: 1, flexShrink: 1, children: [
      Text({ color: p.light, children: [p.glyph] }),
      Text({ bold: true, wrap: 'wrap', children: [p.name] }),
    ] }),
    right ? Text({ dimColor: !hover && !jumping, wrap: 'truncate-end', children: [right] }) : null,
  ].filter(Boolean) })
  // The bar is a row of thin line glyphs (done part, then faint track): a Client has no Svg, and a coloured Box is at least one text row tall, which looked too thick
  const bar = typeof p.pct === 'number'
    // One line of text with two coloured spans: as two side-by-side Texts the done part shrank first and was cut with "…" in the middle of the bar.
    // A line glyph can be drawn wider than one cell, so the line is kept a little short and cut at its end ('truncate-end'; the desktop app ignores plain 'truncate' and wrapped the rest onto a new line)
    ? Box({ overflow: 'hidden', children: [Text({ wrap: 'truncate-end', children: barParts(p, barCells(surface.columns)).map(([text, color]) => Text({ color, children: [text] })) })] })
    : Text({ children: [' '] })
  // Nothing is added under the pointer: an extra line made the block taller, the rows below moved, and a click landed on the next session (2026-10-23)
  return Box({ flexDirection: 'column', backgroundColor: hover || jumping ? p.hoverBg : undefined, children: [line1, bar] })
}

const JUMP_FEEDBACK_MS = 8000 // How long "switching…" stays; the app usually switches within about 5 s (measured 2026-10-21/22)
const BAR_GLYPH = '━'          // Thin horizontal line; repeated it reads as one continuous line
const BAR_FALLBACK_CELLS = 40  // Bar width before the region has been laid out once
const BAR_WIDTH_SHARE = 0.85   // Share of the region's cells the bar fills: leaves room for glyphs drawn wider than a cell (the bar wrapped at 100%, 2026-10-22)

/** [text, colour] pieces of the bar for `cells` columns: the done part, then the remaining track. */
function barParts(p, cells) {
  const done = Math.round((Math.max(0, Math.min(100, p.pct)) / 100) * cells)
  return [[BAR_GLYPH.repeat(done), p.barColor], [BAR_GLYPH.repeat(cells - done), p.track]].filter(([text]) => text)
}

/** How many line glyphs the bar gets: the region's width less a margin, since a glyph may be drawn a little wider than one cell. */
function barCells(columns) {
  if (!columns) return BAR_FALLBACK_CELLS
  return Math.max(4, Math.floor(columns * BAR_WIDTH_SHARE))
}

function isInside(e, surface) {
  return e.x >= 0 && e.y >= 0 && (surface.columns === 0 || e.x < surface.columns) && (surface.rows === 0 || e.y < surface.rows)
}
