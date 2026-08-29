// Static help content, shown when the die-cut checks don't pass (and available
// on demand from the "Show setup guides" button). Authored here as trusted HTML.

export const TUTORIALS = {
  illustrator: `
    <h4>1 &middot; Create a spot colour</h4>
    <ol>
      <li>Open <em>Window &rsaquo; Swatches</em>. From the panel menu (&#9776;) choose <em>New Swatch&hellip;</em></li>
      <li>Set <em>Color Type</em> to <strong>Spot Color</strong>.</li>
      <li>Name it what your printer expects for the cut path &mdash; commonly
          <code>CutContour</code>, <code>Thru-cut</code>, <code>Kiss-cut</code> or <code>Dieline</code>.
          The name is what the finishing machine looks for, so ask if you're unsure.</li>
      <li>Give it a visible colour (e.g. 100% Magenta) so you can see the path. The tint value
          doesn't print &mdash; only the separation matters.</li>
      <li>Click <em>OK</em>. (Alternative: <em>Swatches menu &rsaquo; Open Swatch Library &rsaquo; Color Books &rsaquo;
          PANTONE&hellip;</em> &mdash; Pantone swatches are already spot colours.)</li>
    </ol>

    <h4>2 &middot; Draw the cut path with it</h4>
    <ol>
      <li>Select the cut line. Give it <strong>no fill</strong> and a thin <strong>stroke</strong>
          (0.25&ndash;1 pt) using the new spot swatch.</li>
      <li>Put it on its own layer named e.g. <code>Cut</code> so it's easy to find and to turn off for proofing.</li>
    </ol>

    <h4>3 &middot; Apply overprint</h4>
    <ol>
      <li>Select the cut path. Open <em>Window &rsaquo; Attributes</em>.</li>
      <li>Tick <strong>Overprint Stroke</strong> (and <em>Overprint Fill</em> if the spot colour is a fill,
          such as a varnish flood).</li>
      <li>Check it with <em>View &rsaquo; Overprint Preview</em> &mdash; the artwork under the cut line should
          stay visible, not be knocked out to white.</li>
    </ol>

    <h4>4 &middot; Export</h4>
    <ol>
      <li><em>File &rsaquo; Save a Copy &rsaquo; Adobe PDF</em>. Use <strong>PDF/X-4</strong> or your printer's preset.</li>
      <li>Under <em>Output</em>, set <em>Color Conversion: No Conversion</em> so the spot separation is kept.</li>
      <li>Under <em>Advanced</em>, do <strong>not</strong> tick "Discard Overprints", and don't flatten with
          "Convert All Spot Colors to Process".</li>
    </ol>

    <p class="tut-note">"Simulate Overprint" in the Print / Output dialog is only a proofing preview.
      It is not the same as the object-level overprint in the Attributes panel, which is what actually
      gets written into the PDF.</p>
  `,

  affinity: `
    <h4>1 &middot; Create a spot colour</h4>
    <ol>
      <li>Open <em>Window &rsaquo; Swatches</em>. In the <em>Colour</em> panel, mix the colour you want the
          cut path to show as.</li>
      <li>In the Swatches panel, open the panel menu (&#9776;) and choose
          <strong>Add Current Colour as Spot Colour</strong> (or click the spot-swatch button &mdash; the
          circle marked &ldquo;S&rdquo;). A small triangle marks the swatch as spot.</li>
      <li>Double-click the new swatch and rename it to what your printer expects &mdash;
          <code>CutContour</code>, <code>Thru-cut</code>, <code>Kiss-cut</code> or <code>Dieline</code>.</li>
      <li>(Or <em>Swatches menu &rsaquo; Add Palette &rsaquo; From Application Palettes &rsaquo; PANTONE&hellip;</em>
          for ready-made spot swatches.)</li>
    </ol>

    <h4>2 &middot; Draw the cut path with it</h4>
    <ol>
      <li>Select the cut line. Set <strong>no fill</strong> and a thin <strong>stroke</strong>
          (Stroke panel, ~0.25&ndash;1 pt) using the spot swatch.</li>
      <li>Keep it on its own layer named <code>Cut</code>.</li>
    </ol>

    <h4>3 &middot; Apply overprint</h4>
    <ol>
      <li>Select the cut path. Open <em>Window &rsaquo; Overprint Control</em> (Designer / Publisher v2).</li>
      <li>Enable <strong>Overprint Stroke</strong> (and <em>Overprint Fill</em> for a spot fill such as a varnish).</li>
      <li>Turn on <em>View &rsaquo; Overprint Preview</em> to confirm the artwork under the cut line isn't
          knocked out.</li>
    </ol>

    <h4>4 &middot; Export</h4>
    <ol>
      <li><em>File &rsaquo; Export &rsaquo; PDF</em>. Choose <strong>PDF (press-ready)</strong> or
          <strong>PDF/X-4</strong>.</li>
      <li>Open <em>More&hellip;</em> and set <em>Colour space: As document / Don't convert</em> (do not force
          everything to CMYK or RGB) so the spot plate survives.</li>
      <li>Leave the overprint / passthrough options at their press-ready defaults.</li>
    </ol>

    <p class="tut-note">Menu names shift slightly between Affinity v1 and v2 and between Designer and
      Publisher. If there is no "Overprint Control" panel, update to v2 or use Publisher, where it lives
      under <em>Window &rsaquo; Overprint Control</em>.</p>
  `,
};
