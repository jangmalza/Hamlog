import { useEffect } from 'react';
import type { Post, SiteMeta } from '../types/blog';
import { siteMeta } from '../data/blogData';
import { getPostMetaDescription } from '../utils/postSeo';
import { resolveSiteBaseUrl } from '../utils/siteUrl';

interface UseSchemaProps {
    post: Post | undefined;
    profile?: SiteMeta;
    preserveExisting?: boolean;
}

const POST_SCHEMA_ATTRIBUTE = 'data-hamlog-schema';
const POST_SCHEMA_VALUE = 'post';

const getBaseUrl = (profile?: SiteMeta) => resolveSiteBaseUrl(profile?.siteUrl);

const toAbsoluteUrl = (value?: string, baseUrl = getBaseUrl()) => {
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
};

const resolveFavicon = (profile?: SiteMeta) => {
    const favicon = profile?.favicon?.trim();
    return !favicon || favicon === '/avatar.jpg' ? '/favicon.svg' : favicon;
};

const getArticleDate = (value?: string) => {
    if (!value) return undefined;
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
};

const hasSchemaType = (value: unknown, expectedType: string): boolean => {
    if (Array.isArray(value)) {
        return value.some(item => hasSchemaType(item, expectedType));
    }
    if (!value || typeof value !== 'object') return false;

    const schema = value as Record<string, unknown>;
    const schemaType = schema['@type'];
    if (schemaType === expectedType) return true;
    if (Array.isArray(schemaType) && schemaType.includes(expectedType)) return true;
    return hasSchemaType(schema['@graph'], expectedType);
};

const isBlogPostingScript = (script: HTMLScriptElement) => {
    if (script.getAttribute(POST_SCHEMA_ATTRIBUTE) === POST_SCHEMA_VALUE) return true;

    try {
        return hasSchemaType(JSON.parse(script.textContent ?? ''), 'BlogPosting');
    } catch {
        return false;
    }
};

const findBlogPostingScripts = () => Array.from(
    document.head.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
).filter(isBlogPostingScript);

export const useSchema = ({ post, profile, preserveExisting = false }: UseSchemaProps) => {
    useEffect(() => {
        if (typeof document === 'undefined') return;
        if (preserveExisting) return;

        const existingScripts = findBlogPostingScripts();
        if (!post) {
            existingScripts.forEach(script => script.remove());
            return;
        }

        const baseUrl = getBaseUrl(profile);
        const canonicalUrl = toAbsoluteUrl(post.seo?.canonicalUrl, baseUrl)
            || `${baseUrl}/posts/${post.slug}`;
        const imageUrl = toAbsoluteUrl(
            post.seo?.ogImage || post.cover || '/avatar.jpg',
            baseUrl
        );
        const authorName = profile?.name?.trim() || siteMeta.name;
        const publisherName = profile?.title?.trim() || siteMeta.title;
        const publisherLogo = toAbsoluteUrl(resolveFavicon(profile), baseUrl);

        const schema: Record<string, unknown> = {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": post.seo?.title || post.title,
            "image": imageUrl ? [imageUrl] : [],
            "datePublished": getArticleDate(post.publishedAt),
            "dateModified": getArticleDate(post.updatedAt || post.publishedAt),
            "mainEntityOfPage": canonicalUrl,
            "url": canonicalUrl,
            "author": {
                "@type": "Person",
                "name": authorName,
                "url": baseUrl
            },
            "publisher": {
                "@type": "Organization",
                "name": publisherName,
                "logo": {
                    "@type": "ImageObject",
                    "url": publisherLogo
                }
            },
            "description": getPostMetaDescription(post)
        };

        if (post.category) {
            schema.articleSection = post.category;
        }
        const keywords = post.seo?.keywords?.length ? post.seo.keywords : post.tags;
        if (keywords.length > 0) {
            schema.keywords = keywords.join(', ');
        }

        const [existingScript, ...duplicates] = existingScripts;
        duplicates.forEach(script => script.remove());

        const script = existingScript ?? document.createElement('script');
        script.type = 'application/ld+json';
        script.setAttribute(POST_SCHEMA_ATTRIBUTE, POST_SCHEMA_VALUE);
        script.text = JSON.stringify(schema).replace(/</g, '\\u003c');
        if (!existingScript) {
            document.head.appendChild(script);
        }

    }, [post, profile, preserveExisting]);
};
