import type { JSONContent } from '@tiptap/core';

export interface ProfileDisplaySettings {
    showProfileImage: boolean;
    showLocation: boolean;
    showEmail: boolean;
    showSocialLinks: boolean;
    showNow: boolean;
    showStack: boolean;
}

export interface SiteMeta {
    title: string;
    name: string;
    role: string;
    tagline: string;
    description: string;
    location: string;
    profileImage: string;
    favicon?: string;
    email: string;
    siteUrl: string;
    // Optional so drafts cached before these fields existed never clear them on save.
    titleSuffix?: string;
    keywords?: string[];
    social: {
        github?: string;
        linkedin?: string;
        twitter?: string;
        instagram?: string;
        threads?: string;
        telegram?: string;
    };
    stack: string[];
    now: string;
    display: ProfileDisplaySettings;
}

export interface TopicHighlight {
    title: string;
    description: string;
}

export type PostSection =
    | { type: 'heading'; content: string }
    | { type: 'paragraph'; content: string }
    | { type: 'list'; content: string[] }
    | { type: 'code'; content: string; language?: string }
    | { type: 'quote'; content: string }
    | { type: 'callout'; content: string }
    | { type: 'image'; content: string; alt?: string; caption?: string };

export type PostStatus = 'draft' | 'scheduled' | 'published';
export type PostRevisionEvent = 'baseline' | 'created' | 'updated' | 'restored';

export interface PostSeo {
    title?: string;
    description?: string;
    ogImage?: string;
    canonicalUrl?: string;
    keywords?: string[];
}

export interface Post {
    id: string;
    slug: string;
    /** Server-owned old slugs, reserved for this post and omitted publicly. */
    previousSlugs?: string[];
    title: string;
    summary: string;
    /** Read-only SEO description resolved by the public detail/bootstrap API. */
    metaDescription?: string;
    category?: string;
    contentJson?: JSONContent;
    contentHtml?: string;
    publishedAt: string;
    updatedAt?: string;
    /** Server-owned trash marker. Restoring removes it and returns a private draft. */
    deletedAt?: string;
    /** Server-owned marker: permanent deletion has started and may need retry. */
    purgeRequestedAt?: string;
    tags: string[];
    series?: string;
    featured?: boolean;
    views?: number;
    cover?: string;
    status?: PostStatus;
    scheduledAt?: string;
    seo?: PostSeo;
    sections?: PostSection[];
}

export interface PostRevision {
    id: string;
    postId: string;
    savedAt: string;
    event: PostRevisionEvent;
    title: string;
    slug: string;
    status: PostStatus;
}

export interface PostRevisionDetail extends PostRevision {
    snapshot: Post;
}

export type PostInput = Omit<Post, 'id' | 'metaDescription' | 'deletedAt' | 'purgeRequestedAt' | 'previousSlugs'>;
