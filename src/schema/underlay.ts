import { UsageError } from '../cli/errors.js';
import type { UnderlaySpec } from './spec.js';
import type { VectorBackgroundDTO, ViewBox } from '../api/types.js';

export const UNDERLAY_REFERENCE_WIDTH = 1920;

const UNDERLAY_GROUP_ID = 'sm-background';
const ROW_LABELS_GROUP_ID = 'sm-row-labels';
const SVG_NS = 'http://www.w3.org/2000/svg';

const STRUCTURAL_ATTRIBUTES = new Set([
  'xmlns',
  'viewbox',
  'width',
  'height',
  'preserveaspectratio',
  'x',
  'y',
  'version',
  'baseprofile',
  'contentscripttype',
  'contentstyletype',
]);

type Attribute = readonly [name: string, value: string];

interface SvgDocument {
  attributes: Attribute[];
  inner: string;
}

const attributeValue = (attributes: readonly Attribute[], name: string): string | undefined =>
  attributes.find(([candidate]) => candidate.toLowerCase() === name)?.[1];

function splitSvgDocument(svg: string): SvgDocument {
  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) {
    throw new UsageError('Underlay is not an SVG document: no <svg> element found.');
  }

  const attributes: Attribute[] = [];
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(open[0]);
  while (match !== null) {
    attributes.push([match[1]!, match[3] ?? match[4] ?? '']);
    match = pattern.exec(open[0]);
  }

  if (open[0].endsWith('/>')) {
    return { attributes, inner: '' };
  }

  const contentStart = open.index + open[0].length;
  const closeIndex = svg.toLowerCase().lastIndexOf('</svg>');
  if (closeIndex < contentStart) {
    throw new UsageError('Underlay SVG is malformed: the root <svg> element is never closed.');
  }

  return { attributes, inner: svg.slice(contentStart, closeIndex) };
}

const escapeAttribute = (value: string): string => value.replace(/"/g, '&quot;');

const renderAttributes = (attributes: readonly Attribute[]): string =>
  attributes.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');

const toLength = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export function extractViewBox(svg: string): ViewBox {
  const { attributes } = splitSvgDocument(svg);

  const raw = attributeValue(attributes, 'viewbox');
  if (raw !== undefined) {
    const parts = raw
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((value) => Number.isFinite(value));
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
    }
  }

  const width = toLength(attributeValue(attributes, 'width'));
  const height = toLength(attributeValue(attributes, 'height'));
  if (width !== undefined && height !== undefined) {
    return { x: 0, y: 0, width, height };
  }

  throw new UsageError(
    'Underlay SVG has no usable viewBox or width/height on its root <svg> element.',
    'Add a viewBox attribute; the CLI cannot measure a document it does not render.',
  );
}

export function defaultUnderlayScale(viewBox: ViewBox): number {
  return viewBox.width < UNDERLAY_REFERENCE_WIDTH ? UNDERLAY_REFERENCE_WIDTH / viewBox.width : 1;
}

export function underlayWarnings(svg: string): string[] {
  const warnings: string[] = [];
  if (/class\s*=\s*("|')[^"']*\bsector\b/i.test(svg)) {
    warnings.push(
      'Underlay contains .sector elements. The editor strips those when you upload a background; the CLI passes the file through unchanged.',
    );
  }
  if (svg.includes(ROW_LABELS_GROUP_ID)) {
    warnings.push(
      `Underlay contains a #${ROW_LABELS_GROUP_ID} group. The editor strips generated row labels on upload; the CLI passes the file through unchanged, and the service will treat them as the schema's own row labels.`,
    );
  }
  return warnings;
}

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function toCompositeSvg(backgroundSvg: string, viewBox: ViewBox, place: Placement): string {
  const { attributes, inner } = splitSvgDocument(backgroundSvg);

  const scale = place.width / viewBox.width;
  const translateX = place.x - viewBox.x * scale;
  const translateY = place.y - viewBox.y * scale;
  const matrix = `${scale.toFixed(4)},0,0,${scale.toFixed(4)},${translateX.toFixed(4)},${translateY.toFixed(4)}`;

  const isNamespace = ([name]: Attribute): boolean => name.toLowerCase().startsWith('xmlns:');
  const inherited = attributes.filter(
    (attribute) =>
      !isNamespace(attribute) &&
      !STRUCTURAL_ATTRIBUTES.has(attribute[0].toLowerCase()) &&
      attribute[0].toLowerCase() !== 'id' &&
      attribute[0].toLowerCase() !== 'transform',
  );
  const namespaces = attributes.filter(isNamespace);

  const group = `<g${renderAttributes([
    ...inherited,
    ['id', UNDERLAY_GROUP_ID],
    ['transform', `matrix(${matrix})`],
  ])}>${inner}</g>`;

  const root = renderAttributes([
    ['xmlns', SVG_NS],
    ...namespaces,
    ['viewBox', `${place.x} ${place.y} ${place.width} ${place.height}`],
    ['width', String(Math.round(place.width))],
    ['height', String(Math.round(place.height))],
  ]);

  return `<svg${root}>${group}</svg>`;
}

export function toVectorBackground(spec: UnderlaySpec): VectorBackgroundDTO {
  if (spec.svg === undefined) {
    throw new UsageError('Underlay has no SVG content.', 'Set either "file" or "svg".');
  }

  const viewBox = extractViewBox(spec.svg);
  const place: Placement = {
    x: spec.x ?? viewBox.x,
    y: spec.y ?? viewBox.y,
    width: spec.width ?? viewBox.width,
    height: spec.height ?? viewBox.height,
  };

  return {
    backgroundSvg: spec.svg,
    viewBox,
    ...place,
    scale: spec.scale ?? defaultUnderlayScale(viewBox),
    svg: toCompositeSvg(spec.svg, viewBox, place),
  };
}
