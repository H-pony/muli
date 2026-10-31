import verified from '../../shared/sources/verified.json';
import type { SourceConfig } from './types';

/** Only direct APIs that passed search, detail and video decoding are shipped. */
export const BUILTIN_VOD_SOURCES: readonly SourceConfig[] = verified.vodSources;
