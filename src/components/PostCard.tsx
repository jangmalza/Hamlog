import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { isPrerenderHandoffPending } from '../utils/prerenderState';
import type { Post } from '../data/blogData';
import { formatDate } from '../utils/formatDate';
import { buildImageVariantSrcSet, buildImageVariantUrl } from '../utils/imageUrl';
import SearchHighlight from './SearchHighlight';

interface PostCardProps {
  post: Post;
  variant?: 'featured' | 'compact';
  index?: number;
  searchQuery?: string;
  searchExcerpt?: string;
  returnTo?: string;
}

// Sub-components
const CategoryBadge: React.FC<{ category?: string; className?: string }> = ({ category, className }) => (
  <span className={`angular-chip rounded-lg border border-[color:var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-strong)] ${className}`}>
    {category ?? '미분류'}
  </span>
);

const PostMeta: React.FC<{ post: Post; className?: string }> = ({ post, className }) => {
  return (
    <p className={`text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] ${className}`}>
      {formatDate(post.publishedAt)}
    </p>
  );
};

const TagList: React.FC<{ tags: string[] }> = ({ tags }) => (
  <>
    {tags.map(tag => (
      <span
        key={tag}
        className="angular-chip rounded-lg border border-[color:var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
      >
        #{tag}
      </span>
    ))}
  </>
);

const PostViewCount: React.FC<{ views?: number }> = ({ views }) => {
  const normalizedViews = Number.isSafeInteger(views) && Number(views) >= 0 ? Number(views) : 0;
  const formattedViews = normalizedViews.toLocaleString('ko-KR');

  return (
    <span
      className="ml-auto shrink-0 whitespace-nowrap text-[10px] tabular-nums text-[var(--text-muted)]"
      aria-label={`조회 ${formattedViews}회`}
      data-testid="post-view-count"
    >
      조회 {formattedViews}회
    </span>
  );
};

interface PostImageProps {
  post: Post;
  variant: 'featured' | 'compact';
  eager?: boolean;
  priority?: boolean;
}

const PostImage: React.FC<PostImageProps> = ({ post, variant, eager = false, priority = false }) => {
  if (!post.cover) return null;

  const isFeatured = variant === 'featured';
  const imageWidth = isFeatured ? 720 : 320;
  const imageHeight = isFeatured ? 256 : 192;
  const imageSrc = buildImageVariantUrl(post.cover, { width: imageWidth, height: imageHeight });
  const imageSrcSet = buildImageVariantSrcSet(post.cover, isFeatured
    ? [
        { width: 480, height: 171, descriptor: '480w' },
        { width: 720, height: 256, descriptor: '720w' },
        { width: 960, height: 341, descriptor: '960w' }
      ]
    : [
        { width: 320, height: 192, descriptor: '320w' },
        { width: 640, height: 384, descriptor: '640w' },
        { width: 960, height: 576, descriptor: '960w' }
      ]);

  const wrapperClass = variant === 'featured'
    ? "angular-control relative overflow-hidden rounded-lg"
    : "angular-control overflow-hidden rounded-lg md:h-24 md:w-40";

  const imgClass = variant === 'featured'
    ? "h-32 w-full object-cover transition duration-500 group-hover:scale-105"
    : "h-full w-full object-cover transition duration-500 group-hover:scale-105";

  return (
    <div className={wrapperClass}>
      <img
        src={imageSrc}
        srcSet={imageSrcSet}
        sizes={isFeatured
          ? '(min-width: 1024px) 352px, (min-width: 640px) 50vw, 100vw'
          : '(min-width: 768px) 160px, 100vw'}
        // The title is the link text right next to it; repeating it adds noise for screen readers.
        alt=""
        className={imgClass}
        width={imageWidth}
        height={imageHeight}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : eager ? 'auto' : 'low'}
      />
      {variant === 'featured' && (
        <span className="angular-chip absolute left-3 top-3 rounded-lg border border-[color:var(--border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-[var(--text-muted)] backdrop-blur-sm">
          {post.category ?? '미분류'}
        </span>
      )}
    </div>
  );
};

// Main Component
const PostCard: React.FC<PostCardProps> = ({ post, variant = 'compact', index = 0, searchQuery, searchExcerpt, returnTo }) => {
  // Cards that replace the server-rendered page are already on screen; animating them
  // would hide content the reader is looking at. Later cards (filters, search) animate.
  const [animateEntrance] = useState(() => !isPrerenderHandoffPending());
  const delay = `${Math.min(index, 8) * 60}ms`;
  const isFeatured = variant === 'featured';
  const entranceClass = animateEntrance ? 'animate-slide-up motion-reduce:animate-none' : '';

  const containerClass = isFeatured
    ? `group flex h-full flex-col gap-2.5 border border-[color:var(--border)] bg-[var(--surface)] p-3.5 transition-colors hover:border-[color:var(--border-strong)] ${entranceClass}`
    : `group flex flex-col gap-3 border border-[color:var(--border)] bg-[var(--surface)] p-3.5 transition-colors hover:border-[color:var(--border-strong)] ${entranceClass}`;

  return (
    <Link
      to={`/posts/${post.slug}`}
      state={returnTo ? { returnTo } : undefined}
      className={containerClass}
      style={animateEntrance ? { animationDelay: delay } : undefined}
    >
      {isFeatured ? (
        // Featured Layout
        <>
          <PostImage
            post={post}
            variant="featured"
            eager={index < 3}
            priority={index === 0}
          />
          <PostMeta post={post} />
          <h3 className="font-display text-base font-bold leading-snug text-[var(--text)]">
            {post.title}
          </h3>
          <p className="text-xs text-[var(--text-muted)] line-clamp-2">{post.summary}</p>
          <div className="mt-auto">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={post.category} />
              <TagList tags={post.tags} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="group/link inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent-strong)]">
                Read
                <span aria-hidden="true" className="transition-transform group-hover/link:translate-x-1">&rarr;</span>
              </span>
              <PostViewCount views={post.views} />
            </div>
          </div>
        </>
      ) : (
        // Compact Layout
        <>
          <PostMeta post={post} className="text-xs" />
          <div className="flex flex-col gap-3 md:flex-row">
            <PostImage post={post} variant="compact" />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <div className="space-y-1">
                <h3 className="break-words font-display text-base font-semibold text-[var(--text)]">
                  <SearchHighlight text={post.title} query={searchQuery} />
                </h3>
                <p className="line-clamp-2 break-words text-xs leading-relaxed text-[var(--text-muted)]">
                  <SearchHighlight text={searchExcerpt || post.summary} query={searchQuery} />
                </p>
              </div>
              <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <CategoryBadge category={post.category} className="px-2 py-0.5 text-[10px]" />
                  <TagList tags={post.tags} />
                </div>
                <PostViewCount views={post.views} />
              </div>
            </div>
          </div>
        </>
      )}
    </Link>
  );
};

export default PostCard;
