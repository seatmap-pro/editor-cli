export interface Page<T> {
  content: T[];
  totalElements?: number;
  totalPages?: number;
  number?: number;
  size?: number;
}

export interface UserSummary {
  id?: number;
  email?: string;
  name?: string;
  organizationId?: number;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  refreshToken?: string;
  user?: UserSummary;
  error?: string;
}

export interface VenueDTO {
  id: number;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  libraryListed?: boolean;
}

export interface BitmapBackgroundDTO {
  id: string;
  scale?: number;
  visible?: boolean;
  uploaded?: boolean;
}

export interface SchemaDTO {
  id: number;
  name: string;
  description?: string;
  draft?: boolean;
  template?: boolean;
  gaCapacity?: number;
  venueId?: number;
  seatsCount?: number;
  seatsCapacity?: number;
  preview?: string;
  venue?: VenueDTO;
  numberingDefaults?: unknown;
  bitmapBackground?: BitmapBackgroundDTO;
}

export interface OrganizationDTO {
  id: number;
  name: string;
  type?: string;
  tenantId?: number;
  tenantName?: string;
  numberOfVenues?: number;
  numberOfSchemas?: number;
  numberOfUsers?: number;
  libraryPublisher?: boolean;
  publicKey?: string;
  lastActivityDate?: string;
}

export interface CreateOrganizationResult extends OrganizationDTO {
  privateKey?: string;
  user?: UserSummary;
}

export interface TenantDTO {
  id: number;
  name: string;
  numberOfOrganizations?: number;
}

export interface OrganizationUserDTO {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  roles?: string[];
}

export interface LibraryVenueDTO {
  id: number;
  name: string;
  address?: string;
  organizationId?: number;
  organizationName?: string;
  numberOfSchemas?: number;
  libraryListedAt?: string;
}

export interface LibraryCopyResponse {
  venueId: number;
  schemaId?: number;
}

export interface MoveResult {
  venueId?: number;
  schemaId?: number;
  fromVenueId?: number;
  fromOrganizationId?: number;
  toOrganizationId?: number;
  movedSchemas: number;
  movedEvents: number;
}

export interface EventDTO {
  id: string;
  name: string;
  schemaId?: number;
  schemaName?: string;
  venueName?: string;
  status?: string;
  startsAt?: string;
  externalId?: string;
}

export type SectionTitlePosition = 'NONE' | 'TOP' | 'BOTTOM';

export type SectionOutlineMode = 'NONE' | 'AUTO' | 'SVG';

export interface TransformationDTO {
  type: string;
  value: number;
  params: string;
}

export interface SectorDTO {
  id?: number;
  guid: string;
  name: string;
  ga: boolean;
  x: number;
  y: number;
  outline?: string;
  transformations?: TransformationDTO[];
  rlLeft?: boolean;
  rlRight?: boolean;
  rlCenter?: boolean;
  rlAlignMode?: string;
  outlineMode?: SectionOutlineMode;
  outlinePaddingTop?: number;
  outlinePaddingRight?: number;
  outlinePaddingBottom?: number;
  outlinePaddingLeft?: number;
  titlePosition?: SectionTitlePosition;
  titleFontScale?: number;
  labelVisible?: boolean;
  labelAnchorX?: number;
  labelAnchorY?: number;
  labelStyle?: string;
  outlineStyle?: string;
  priceId?: number;
  zoneId?: number;
  toRemove?: boolean;
}

export interface RowDTO {
  id?: number;
  guid: string;
  sectorGuid: string;
  name: string;
  rowNumber: string;
  seatName?: string;
  sectorId?: number;
  seatSpacing?: number;
}

export interface SeatDTO {
  id?: number;
  guid: string;
  rowGuid: string;
  name: string;
  x: number;
  y: number;
  ax: number;
  ay: number;
  rowId?: number;
  sectorId?: number;
  zoneId?: number;
  angle?: number;
  isAccessible?: boolean;
  isHidden?: boolean;
  isMarked?: boolean;
  toRemove?: boolean;
}

export type SimpleShapeType = 'RECT' | 'CIRCLE' | 'LINE' | 'POLYGON';

export type ShapePurpose = 'OBJECT' | 'UNDERLAY' | 'GA' | 'OUTLINE';

export interface SimpleShapeDTO {
  type: 'shape';
  id: string;
  shapeType: SimpleShapeType;
  purpose: ShapePurpose;
  groupOfSeatsGuid?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
  order?: number;
  text?: string;
  fill?: string;
  stroke?: string;
  textColor?: string;
  borderWidth?: string;
  fontScale?: number;
  points?: Array<{ x: number; y: number }>;
}

export interface LabelShapeDTO {
  type: 'label';
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
  order?: number;
  text?: string;
  fill?: string;
  fontScale?: number;
}

export type ShapeDTO = SimpleShapeDTO | LabelShapeDTO;

export interface ClientViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
  isControlledManually: boolean;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VectorBackgroundDTO {
  backgroundSvg: string;
  viewBox: ViewBox;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  svg?: string;
  outlineSvg?: string;
}

export interface SeatmapDTO {
  seats: SeatDTO[];
  rows: RowDTO[];
  sectors: SectorDTO[];
  shapes?: ShapeDTO[];
  vectorBackground?: VectorBackgroundDTO;
  clientViewBox?: ClientViewBox;
}
