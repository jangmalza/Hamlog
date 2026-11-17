import { useEffect } from 'react';
import { resolveSiteBaseUrl } from '../utils/siteUrl';

interface SeoProps {
    title?: string;
    description?: string;
    image?: string;
    keywords?: string[];
    url?: string;
    type?: 'article' | 'website';
    favicon?: string;
    twitterHandle?: string;
    robots?: RobotsDirective;
    preserveExisting?: boolean;
}

export type RobotsDirective = 'index, follow' | 'noindex, nofollow';

// Relative URLs resolve against the site base like the server-rendered tags do.
const toAbsoluteUrl = (value?: string) => {
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    const baseUrl = resolveSiteBaseUrl();
    if (!baseUrl) return value;
    return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
};

const setMetaTag = (key: string, content: string, attr: 'name' | 'property') => {
    const selector = `meta[${attr}="${key}"]`;
    const elements = Array.from(document.head.querySelectorAll<HTMLMetaElement>(selector));
    const [first, ...duplicates] = elements;
    duplicates.forEach(element => element.remove());

    if (!content) {
        first?.remove();
        return;
    }

    const element = first ?? document.createElement('meta');
    if (!first) {
        element.setAttribute(attr, key);
        document.head.appendChild(element);
    }
    element.setAttribute('content', content);
};

const setLinkTag = (rel: string, href: string) => {
    const selector = `link[rel="${rel}"]`;
    const elements = Array.from(document.head.querySelectorAll<HTMLLinkElement>(selector));
    const [first, ...duplicates] = elements;
    duplicates.forEach(element => element.remove());

    if (!href) {
        first?.remove();
        return;
    }

    const element = first ?? document.createElement('link');
    if (!first) {
        element.setAttribute('rel', rel);
        document.head.appendChild(element);
    }
    element.setAttribute('href', href);
};

export const useRobots = (robots: RobotsDirective) => {
    useEffect(() => {
        if (typeof document === 'undefined') return;
        setMetaTag('robots', robots, 'name');
    }, [robots]);
};

export const useSeo = ({
    title,
    description,
    image,
    keywords,
    url,
    type = 'article',
    favicon,
    twitterHandle,
    robots,
    preserveExisting = false,
}: SeoProps) => {
    useEffect(() => {
        if (typeof document === 'undefined') return;
        if (preserveExisting) return;

        const seoTitle = title ?? '';
        const seoDescription = description ?? '';
        const seoImage = toAbsoluteUrl(image);
        const seoKeywords = keywords?.join(', ') ?? '';
        const canonicalUrl = toAbsoluteUrl(url) || window.location.href;
        const seoFavicon = toAbsoluteUrl(favicon ?? '/favicon.svg');

        if (seoTitle) {
            document.title = seoTitle;
        }

        setMetaTag('description', seoDescription, 'name');
        setMetaTag('keywords', seoKeywords, 'name');
        if (robots) {
            setMetaTag('robots', robots, 'name');
        }
        setMetaTag('og:title', seoTitle, 'property');
        setMetaTag('og:description', seoDescription, 'property');
        setMetaTag('og:image', seoImage, 'property');
        setMetaTag('og:type', type, 'property');
        setMetaTag('og:url', canonicalUrl, 'property');
        setMetaTag('twitter:card', seoImage ? 'summary_large_image' : 'summary', 'name');
        setMetaTag('twitter:title', seoTitle, 'name');
        setMetaTag('twitter:description', seoDescription, 'name');
        setMetaTag('twitter:image', seoImage, 'name');
        setMetaTag('twitter:site', twitterHandle ?? '', 'name');
        setMetaTag('twitter:creator', twitterHandle ?? '', 'name');
        setLinkTag('canonical', canonicalUrl);
        setLinkTag('icon', seoFavicon);
        setLinkTag('apple-touch-icon', seoFavicon);
    }, [title, description, image, keywords, url, type, favicon, twitterHandle, robots, preserveExisting]);
};
