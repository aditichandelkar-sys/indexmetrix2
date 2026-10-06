/**
 * Project Utilities for INDEX METRIX
 * Differentiates owned Search Console properties from 3rd-party / external links projects.
 */

export interface ProjectLike {
  id?: string;
  name?: string | null;
  domain?: string | null;
  googlePropertyId?: string | null;
  googlePropertyUrl?: string | null;
  properties?: Array<any> | null;
}

/**
 * Returns true if a project is designated for third-party, external, forum, or backlink URLs.
 */
export function isThirdPartyProject(project?: ProjectLike | null): boolean {
  if (!project) return false;

  const domain = (project.domain || '').trim().toLowerCase();
  const name = (project.name || '').trim().toLowerCase();

  // Known third-party workspace domain
  if (domain === 'third-party-links.io' || domain === 'external' || domain === '3rd-party') {
    return true;
  }

  // Known third-party workspace names
  if (
    name.includes('3rd-party') ||
    name.includes('third-party') ||
    name.includes('external link') ||
    name.includes('backlinks')
  ) {
    return true;
  }

  return false;
}
