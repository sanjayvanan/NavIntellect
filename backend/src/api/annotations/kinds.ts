import { z } from 'zod';

/**
 * Annotation kinds. Each entry defines the geometry it accepts and the shape of its `style`.
 * Adding a kind (e.g. a saved route as a LineString) is one entry here plus extending the
 * `kind` CHECK constraint in a migration.
 */

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const position = z.tuple([lng, lat]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be #rrggbb');

export const PIN_ICONS = ['pin', 'anchor', 'flag', 'warning', 'camera', 'star'] as const;

export const ANNOTATION_KINDS = {
  pin: {
    geometry: z.object({ type: z.literal('Point'), coordinates: position }),
    style: z.object({ color: color.default('#16c5d8'), icon: z.enum(PIN_ICONS).default('pin') }).strict(),
  },
} as const;

export type AnnotationKind = keyof typeof ANNOTATION_KINDS;
export const KIND_NAMES = Object.keys(ANNOTATION_KINDS) as [AnnotationKind, ...AnnotationKind[]];
export const kindSchema = z.enum(KIND_NAMES);
