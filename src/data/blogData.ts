import type { SiteMeta, TopicHighlight } from '../types/blog';
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_TITLE } from '../../server/utils/siteIdentity.js';

export * from '../types/blog';

export const siteMeta: SiteMeta = {
  title: DEFAULT_SITE_TITLE,
  name: 'Author Name',
  role: 'Role',
  tagline: 'Tagline',
  description: DEFAULT_SITE_DESCRIPTION,
  location: 'Location',
  profileImage: '/avatar.jpg',
  favicon: '/avatar.jpg',
  email: '',
  siteUrl: '',
  social: {
    github: '',
    linkedin: '',
    twitter: '',
    instagram: ''
  },
  stack: [],
  now: '',
  display: {
    showProfileImage: true,
    showLocation: true,
    showEmail: true,
    showSocialLinks: true,
    showNow: true,
    showStack: true
  }
};

export const topicHighlights: TopicHighlight[] = [];
