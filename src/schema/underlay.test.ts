import { describe, expect, it } from 'vitest';
import {
  defaultUnderlayScale,
  extractViewBox,
  toCompositeSvg,
  toVectorBackground,
  underlayWarnings,
  UNDERLAY_REFERENCE_WIDTH,
} from './underlay.js';
import { UsageError } from '../cli/errors.js';

const svgWithViewBox = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 800 400"></svg>';

describe('extractViewBox', () => {
  it('reads the viewBox attribute', () => {
    expect(extractViewBox(svgWithViewBox)).toEqual({ x: -10, y: -20, width: 800, height: 400 });
  });

  it('accepts comma separated values and a leading xml declaration', () => {
    const svg = '<?xml version="1.0"?>\n<svg viewBox="0,0,120,60"><rect /></svg>';
    expect(extractViewBox(svg)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
  });

  it('is case insensitive about the attribute name', () => {
    expect(extractViewBox('<SVG VIEWBOX="0 0 50 25"></SVG>')).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 25,
    });
  });

  it('falls back to width and height when there is no viewBox', () => {
    const svg = '<svg width="640px" height="480px"></svg>';
    expect(extractViewBox(svg)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });

  it('rejects a document with no svg element', () => {
    expect(() => extractViewBox('<html></html>')).toThrow(UsageError);
  });

  it('rejects a document that cannot be measured', () => {
    expect(() => extractViewBox('<svg></svg>')).toThrow(UsageError);
    expect(() => extractViewBox('<svg viewBox="0 0 0 0"></svg>')).toThrow(UsageError);
  });
});

describe('defaultUnderlayScale', () => {
  it('scales narrow documents up to the reference width', () => {
    expect(defaultUnderlayScale({ x: 0, y: 0, width: 960, height: 480 })).toBe(2);
  });

  it('leaves documents at or above the reference width alone', () => {
    expect(defaultUnderlayScale({ x: 0, y: 0, width: UNDERLAY_REFERENCE_WIDTH, height: 100 })).toBe(
      1,
    );
    expect(defaultUnderlayScale({ x: 0, y: 0, width: 4000, height: 100 })).toBe(1);
  });
});

describe('underlayWarnings', () => {
  it('is quiet for a plain drawing', () => {
    expect(underlayWarnings('<svg viewBox="0 0 10 10"><path d="M0 0" /></svg>')).toEqual([]);
  });

  it('warns about exported sector geometry', () => {
    const warnings = underlayWarnings('<svg viewBox="0 0 10 10"><g class="sector a1"></g></svg>');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.sector');
  });

  it('warns about generated row labels', () => {
    const warnings = underlayWarnings('<svg viewBox="0 0 10 10"><g id="sm-row-labels"></g></svg>');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('sm-row-labels');
  });
});

describe('toVectorBackground', () => {
  it('derives placement and scale from the document', () => {
    const background = toVectorBackground({ svg: svgWithViewBox });

    expect(background.backgroundSvg).toBe(svgWithViewBox);
    expect(background.viewBox).toEqual({ x: -10, y: -20, width: 800, height: 400 });
    expect(background).toMatchObject({ x: -10, y: -20, width: 800, height: 400 });
    expect(background.scale).toBe(UNDERLAY_REFERENCE_WIDTH / 800);
  });

  it('emits the composite the service reads and no outline layer', () => {
    const background = toVectorBackground({ svg: svgWithViewBox });

    expect(background.svg).toContain('id="sm-background"');
    expect(background.outlineSvg).toBeUndefined();
  });

  it('honours explicit placement overrides', () => {
    const background = toVectorBackground({
      svg: svgWithViewBox,
      x: 100,
      y: 200,
      width: 1600,
      height: 800,
      scale: 1,
    });

    expect(background).toMatchObject({ x: 100, y: 200, width: 1600, height: 800, scale: 1 });
    expect(background.viewBox).toEqual({ x: -10, y: -20, width: 800, height: 400 });
  });

  it('rejects a spec whose file was never resolved to svg content', () => {
    expect(() => toVectorBackground({ file: 'plan.svg' })).toThrow(UsageError);
  });
});

describe('toCompositeSvg', () => {
  const viewBox = { x: 0, y: 0, width: 100, height: 50 };

  it('wraps the artwork in the group the service extracts', () => {
    const composite = toCompositeSvg(
      '<svg viewBox="0 0 100 50"><rect width="100" height="50" /></svg>',
      viewBox,
      { x: 0, y: 0, width: 100, height: 50 },
    );

    expect(composite).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">' +
        '<g id="sm-background" transform="matrix(1.0000,0,0,1.0000,0.0000,0.0000)">' +
        '<rect width="100" height="50" /></g></svg>',
    );
  });

  it('maps the source viewbox onto the placement rect', () => {
    const composite = toCompositeSvg(
      '<svg viewBox="-10 -20 100 50"><path /></svg>',
      {
        x: -10,
        y: -20,
        width: 100,
        height: 50,
      },
      { x: 300, y: 400, width: 200, height: 100 },
    );

    expect(composite).toContain('transform="matrix(2.0000,0,0,2.0000,320.0000,440.0000)"');
    expect(composite).toContain('viewBox="300 400 200 100"');
  });

  it('keeps presentation attributes and hoists extra namespaces', () => {
    const composite = toCompositeSvg(
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" width="100" fill="#eee" class="plan"><g /></svg>',
      viewBox,
      viewBox,
    );

    expect(composite).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(composite).toContain('fill="#eee"');
    expect(composite).toContain('class="plan"');
    expect(composite).not.toContain('<g xmlns:xlink');
    expect(composite).not.toContain('<g fill="#eee" width');
  });

  it('preserves the case of attribute names it copies', () => {
    const composite = toCompositeSvg(
      '<svg viewBox="0 0 100 50" zoomAndPan="disable" systemLanguage="en"><path /></svg>',
      viewBox,
      viewBox,
    );

    expect(composite).toContain('zoomAndPan="disable"');
    expect(composite).toContain('systemLanguage="en"');
  });

  it('overrides an id or transform already on the root element', () => {
    const composite = toCompositeSvg(
      '<svg id="plan" transform="rotate(30)" viewBox="0 0 100 50"><path /></svg>',
      viewBox,
      viewBox,
    );

    expect(composite).not.toContain('id="plan"');
    expect(composite).not.toContain('rotate(30)');
    expect(composite).toContain('id="sm-background"');
  });

  it('copies already escaped values without escaping them twice', () => {
    const composite = toCompositeSvg(
      '<svg viewBox="0 0 100 50" data-note="a &amp; b"><path /></svg>',
      viewBox,
      viewBox,
    );

    expect(composite).toContain('data-note="a &amp; b"');
    expect(composite).not.toContain('&amp;amp;');
  });

  it('requotes a single quoted value that contains a double quote', () => {
    const composite = toCompositeSvg(
      `<svg viewBox="0 0 100 50" style='font-family: "Helvetica"'><path /></svg>`,
      viewBox,
      viewBox,
    );

    expect(composite).toContain('style="font-family: &quot;Helvetica&quot;"');
  });

  it('handles an empty self closing document', () => {
    expect(toCompositeSvg('<svg viewBox="0 0 100 50" />', viewBox, viewBox)).toContain(
      '<g id="sm-background" transform="matrix(1.0000,0,0,1.0000,0.0000,0.0000)"></g>',
    );
  });

  it('rejects a document whose root element is never closed', () => {
    expect(() => toCompositeSvg('<svg viewBox="0 0 100 50">', viewBox, viewBox)).toThrow(
      UsageError,
    );
  });
});
