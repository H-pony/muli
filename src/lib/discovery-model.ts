import type { DoubanItem } from './types';

export type DiscoveryCategory = 'movies' | 'tv' | 'shows';
export type DiscoverySort = 'recommend' | 'new' | 'rating';

export interface DiscoveryFilters {
  category: DiscoveryCategory;
  genre: string;
  region: string;
  year: string;
  sort: DiscoverySort;
}

export interface DiscoveryResponse {
  items: DoubanItem[];
  nextStart: number | null;
  hasMore: boolean;
  total?: number;
}

export interface DiscoveryOption {
  value: string;
  label: string;
}

export const DISCOVERY_CATEGORIES: readonly DiscoveryOption[] = [
  { value: 'movies', label: '电影' },
  { value: 'tv', label: '剧集' },
  { value: 'shows', label: '综艺' },
];

export const DISCOVERY_SORTS: readonly DiscoveryOption[] = [
  { value: 'recommend', label: '综合推荐' },
  { value: 'new', label: '最新上映' },
  { value: 'rating', label: '评分最高' },
];

const options = (label: string, values: readonly string[]): readonly DiscoveryOption[] => [
  { value: '', label }, ...values.map((value) => ({ value, label: value })),
];

export const DISCOVERY_GENRES: Readonly<Record<DiscoveryCategory, readonly DiscoveryOption[]>> = {
  movies: options('全部类型', ['剧情', '喜剧', '爱情', '动作', '科幻', '动画', '悬疑', '犯罪', '惊悚', '冒险', '奇幻', '恐怖', '战争', '历史', '纪录片']),
  tv: options('全部类型', ['剧情', '喜剧', '爱情', '悬疑', '犯罪', '古装', '家庭', '科幻', '动画', '历史', '战争', '动作', '冒险', '奇幻', '惊悚']),
  shows: options('全部类型', ['真人秀', '脱口秀', '音乐', '歌舞']),
};

export const DISCOVERY_REGIONS: readonly DiscoveryOption[] = options('全部地区', [
  '中国大陆', '中国香港', '中国台湾', '日本', '韩国', '美国', '英国', '法国', '印度', '泰国',
]);

const currentYear = new Date().getUTCFullYear();
export const DISCOVERY_YEARS: readonly DiscoveryOption[] = options('全部年份',
  Array.from({ length: currentYear - 1979 }, (_, index) => String(currentYear - index))
);

export function isDiscoveryCategory(value: unknown): value is DiscoveryCategory {
  return value === 'movies' || value === 'tv' || value === 'shows';
}

export function defaultDiscoveryFilters(category: DiscoveryCategory = 'movies'): DiscoveryFilters {
  return { category, genre: '', region: '', year: '', sort: 'recommend' };
}

/** 读取浏览页 URL。未知值回到实际可用的默认选项，不扩散到上游请求。 */
export function parseDiscoveryFilters(params: URLSearchParams, category?: DiscoveryCategory): DiscoveryFilters {
  const categoryValue = params.get('category');
  const resolvedCategory = category || (isDiscoveryCategory(categoryValue) ? categoryValue : 'movies');
  const accepted = (value: string | null, choices: readonly DiscoveryOption[]) =>
    value && choices.some((choice) => choice.value === value) ? value : '';
  const sort = params.get('sort');
  return {
    category: resolvedCategory,
    genre: accepted(params.get('genre'), DISCOVERY_GENRES[resolvedCategory]),
    region: accepted(params.get('region'), DISCOVERY_REGIONS),
    year: accepted(params.get('year'), DISCOVERY_YEARS),
    sort: sort === 'new' || sort === 'rating' ? sort : 'recommend',
  };
}

/** 只保存筛选字段，详情/历史面板的临时参数由导航机制独立管理。 */
export function discoverySearchParams(filters: DiscoveryFilters): URLSearchParams {
  const params = new URLSearchParams({ category: filters.category });
  if (filters.genre) params.set('genre', filters.genre);
  if (filters.region) params.set('region', filters.region);
  if (filters.year) params.set('year', filters.year);
  if (filters.sort !== 'recommend') params.set('sort', filters.sort);
  return params;
}

export function discoveryFilterKey(filters: DiscoveryFilters): string {
  return discoverySearchParams(filters).toString();
}

export function discoveryCategoryLabel(category: DiscoveryCategory): string {
  return DISCOVERY_CATEGORIES.find((option) => option.value === category)!.label;
}
