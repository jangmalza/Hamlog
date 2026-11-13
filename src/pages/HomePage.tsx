import ErrorBoundary from '../components/ErrorBoundary';
import LoadingSpinner from '../components/LoadingSpinner';
import { HomeHeader } from '../components/HomeHeader';
import { HomeFooter } from '../components/HomeFooter';
import { FeaturedSection } from '../components/home/FeaturedSection';
import { PostListSection } from '../components/home/PostListSection';

import { useSeo } from '../hooks/useSeo';
import { useSchema } from '../hooks/useSchema';
import { useHomeData } from '../hooks/useHomeData';
import { useHomePostFilter } from '../hooks/useHomePostFilter';
import { DEFAULT_SITE_DESCRIPTION, formatHomeTitle, resolveHomeKeywords } from '../../server/utils/siteIdentity.js';

const HomePage = () => {
    // 1. Data Fetching Hook
    const {
        profile,
        managedCategories,
        posts,
        loading,
        error,
        fetchPosts,
        hasLoaded
    } = useHomeData();

    // 2. Filtering & Logic Hook
    const {
        selectedCategory,
        selectedTag,
        selectedSeries,
        clearReaderFilter,
        selectCategory,
        searchQuery,
        setSearchQuery,
        normalizedQuery,
        setIsComposing,
        searchLoading,
        searchError,
        searchActive,
        searchTotal,
        searchHasMore,
        loadMore,
        retrySearch,
        sortedPosts,
        popularPosts,
        filteredPosts,
        categoryTree
    } = useHomePostFilter({ posts, managedCategories });

    const homeTitle = formatHomeTitle(profile);
    const homeDescription = profile.description?.trim() || DEFAULT_SITE_DESCRIPTION;
    const homeKeywords = resolveHomeKeywords(profile);
    const configuredFavicon = profile.favicon?.trim();
    const homeFavicon = !configuredFavicon || configuredFavicon === '/avatar.jpg'
        ? '/favicon.svg'
        : configuredFavicon;
    const homeImage = profile.profileImage?.trim()
        || configuredFavicon
        || '/avatar.jpg';

    // 3. SEO Hook
    useSeo({
        title: homeTitle,
        description: homeDescription,
        image: homeImage,
        keywords: homeKeywords,
        url: profile.siteUrl,
        type: 'website',
        favicon: homeFavicon,
        twitterHandle: profile.social.twitter,
        robots: 'index, follow'
    });
    useSchema({ post: undefined });

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
                <LoadingSpinner message="블로그 정보 불러오는 중..." />
            </div>
        );
    }

    return (
        <ErrorBoundary>
            <div className="public-site min-h-screen text-[var(--text)]">
                <HomeHeader
                    profile={profile}
                    postCount={sortedPosts.length}
                    categoryCount={categoryTree.allNames.length}
                />

                <main>
                    {!hasLoaded && !error && posts.length === 0 && (
                        <section className="mx-auto max-w-6xl px-4 py-12">
                            <LoadingSpinner message="글 불러오는 중..." />
                        </section>
                    )}

                    {error && posts.length === 0 && (
                        <section className="mx-auto max-w-6xl px-4 py-12">
                            <div className="rounded-xl border border-[color:var(--border)] bg-[var(--surface)] p-6 text-center">
                                <p className="text-sm text-[var(--text-muted)]">{error}</p>
                                <button
                                    type="button"
                                    onClick={() => fetchPosts()}
                                    className="mt-4 rounded-lg border border-[color:var(--border)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text)]"
                                >
                                    다시 시도
                                </button>
                            </div>
                        </section>
                    )}

                    {!searchActive && !selectedCategory && <FeaturedSection posts={popularPosts} />}

                    <PostListSection
                        filteredPosts={filteredPosts}
                        categoryTree={categoryTree}
                        selectedCategory={selectedCategory}
                        selectedTag={selectedTag}
                        selectedSeries={selectedSeries}
                        searchQuery={searchQuery}
                        normalizedQuery={normalizedQuery}
                        searchLoading={searchLoading}
                        searchError={searchError}
                        searchActive={searchActive}
                        searchTotal={searchTotal}
                        searchHasMore={searchHasMore}
                        onLoadMore={() => void loadMore()}
                        onClearReaderFilter={clearReaderFilter}
                        hasLoaded={hasLoaded}
                        loading={loading}
                        error={error}
                        onSelectCategory={selectCategory}
                        onSearchChange={setSearchQuery}
                        onClearSearch={() => setSearchQuery('')}
                        onSearchCompositionChange={setIsComposing}
                        onRetrySearch={retrySearch}
                    />
                </main>

                <HomeFooter profile={profile} />
            </div>
        </ErrorBoundary>
    );
};

export default HomePage;
