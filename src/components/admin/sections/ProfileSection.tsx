import React, { useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import LoadingSpinner from '../../LoadingSpinner';
import type { SiteMeta } from '../../../data/blogData';
import { uploadLocalImage } from '../../../api/uploadApi';
import { SOCIAL_FIELDS } from '../profile/constants';
import ProfileEditorSections from '../profile/ProfileEditorSections';
import ProfilePreviewPanel from '../profile/ProfilePreviewPanel';
import ProfileWorkspaceHeader from '../profile/ProfileWorkspaceHeader';
import type { ProfileSectionProps, ProfileStats, SocialPreviewItem } from '../profile/types';

const ProfileSection: React.FC<ProfileSectionProps> = ({
  profileDraft,
  profileLoading,
  profileSaving,
  profileError,
  profileNotice,
  onProfileChange,
  onProfileSocialChange,
  onSave,
  onReload
}) => {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    field: 'profileImage' | 'favicon'
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const { url } = await uploadLocalImage(file);
      onProfileChange(field, url);
    } catch (error) {
      console.error('Failed to upload image', error);
      alert(field === 'favicon' ? '파비콘 업로드에 실패했습니다.' : '이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleDisplayToggle = (key: keyof SiteMeta['display']) => {
    if (!profileDraft) return;
    onProfileChange('display', {
      ...profileDraft.display,
      [key]: !profileDraft.display[key]
    });
  };

  const profileStats = useMemo<ProfileStats>(() => {
    if (!profileDraft) {
      return {
        completionRate: 0,
        completedBaseFields: 0,
        totalBaseFields: 9,
        socialCount: 0,
        assetCount: 0
      };
    }

    const baseFields = [
      profileDraft.title,
      profileDraft.tagline,
      profileDraft.description,
      profileDraft.name,
      profileDraft.role,
      profileDraft.location,
      profileDraft.email,
      profileDraft.profileImage,
      profileDraft.now
    ];
    const completedBaseFields = baseFields.filter(value => String(value ?? '').trim()).length;
    const socialCount = Object.values(profileDraft.social ?? {}).filter(value => String(value ?? '').trim()).length;
    const assetCount = [profileDraft.profileImage, profileDraft.favicon].filter(value => String(value ?? '').trim()).length;

    return {
      completionRate: Math.round((completedBaseFields / baseFields.length) * 100),
      completedBaseFields,
      totalBaseFields: baseFields.length,
      socialCount,
      assetCount
    };
  }, [profileDraft]);

  const socialPreviewItems = useMemo<SocialPreviewItem[]>(() => {
    if (!profileDraft) return [];

    return SOCIAL_FIELDS
      .filter(({ key }) => String(profileDraft.social?.[key] ?? '').trim())
      .map(({ key, label, icon }) => ({
        key,
        label,
        icon
      }));
  }, [profileDraft]);

  const identityFallback = useMemo(() => {
    const trimmedName = profileDraft?.name?.trim() ?? '';
    if (!trimmedName) return 'ME';
    return trimmedName
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0] ?? '')
      .join('')
      .toUpperCase();
  }, [profileDraft?.name]);

  if (profileLoading && !profileDraft) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[var(--surface)] p-8">
        <LoadingSpinner message="소개 정보를 불러오는 중..." />
      </div>
    );
  }

  if (!profileDraft) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[var(--surface)] p-8">
        <p className="text-sm text-[var(--text-muted)]">
          소개 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.
        </p>
        <button
          type="button"
          onClick={onReload}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[color:var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:border-[color:var(--accent)] hover:text-[var(--accent-strong)]"
        >
          <RefreshCw size={14} />
          다시 불러오기
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <ProfilePreviewPanel
        profileDraft={profileDraft}
        profileStats={profileStats}
        socialPreviewItems={socialPreviewItems}
        identityFallback={identityFallback}
      />

      <div className="space-y-6">
        <ProfileWorkspaceHeader
          profileNotice={profileNotice}
          profileError={profileError}
          profileSaving={profileSaving}
          profileLoading={profileLoading}
          onReload={onReload}
          onSave={onSave}
        />

        <ProfileEditorSections
          profileDraft={profileDraft}
          uploading={uploading}
          fileInputRef={fileInputRef}
          faviconInputRef={faviconInputRef}
          onProfileChange={onProfileChange}
          onProfileSocialChange={onProfileSocialChange}
          onDisplayToggle={handleDisplayToggle}
          onImageUpload={handleImageUpload}
        />
      </div>
    </div>
  );
};

export default ProfileSection;
