import React from 'react';
import {
  BriefcaseBusiness,
  Eye,
  EyeOff,
  Globe,
  ImagePlus,
  Mail,
  MapPin,
  UserRound
} from 'lucide-react';
import type { SiteMeta } from '../../../data/blogData';
import { DISPLAY_FIELDS, SOCIAL_FIELDS } from './constants';
import { Field, SectionCard, TagListInput, inputClassName, textareaClassName } from './shared';
import type { ProfileChangeHandler, ProfileSocialChangeHandler } from './types';

interface ProfileEditorSectionsProps {
  profileDraft: SiteMeta;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  faviconInputRef: React.RefObject<HTMLInputElement>;
  onProfileChange: ProfileChangeHandler;
  onProfileSocialChange: ProfileSocialChangeHandler;
  onDisplayToggle: (key: keyof SiteMeta['display']) => void;
  onImageUpload: (event: React.ChangeEvent<HTMLInputElement>, field: 'profileImage' | 'favicon') => void;
}

const ProfileEditorSections = ({
  profileDraft,
  uploading,
  fileInputRef,
  faviconInputRef,
  onProfileChange,
  onProfileSocialChange,
  onDisplayToggle,
  onImageUpload
}: ProfileEditorSectionsProps) => (
  <div className="grid gap-6 lg:grid-cols-2">
    <SectionCard
      eyebrow="브랜드"
      title="블로그 첫 인상"
      description="홈 상단과 SEO 기본값에 연결되는 제목과 카피를 정리합니다."
    >
      <div className="space-y-4">
        <Field label="블로그 이름">
          <input
            value={profileDraft.title ?? ''}
            onChange={event => onProfileChange('title', event.target.value)}
            className={inputClassName}
          />
        </Field>
        <Field label="제목 뒤 문구" hint="홈 제목 뒤에 ' | 문구'로 붙습니다. 비워 두면 블로그 이름만 씁니다.">
          <input
            value={profileDraft.titleSuffix ?? ''}
            onChange={event => onProfileChange('titleSuffix', event.target.value)}
            placeholder="개발 기록"
            className={inputClassName}
          />
        </Field>
        <Field label="태그라인" hint="홈 헤더에서 가장 크게 노출됩니다.">
          <input
            value={profileDraft.tagline ?? ''}
            onChange={event => onProfileChange('tagline', event.target.value)}
            className={inputClassName}
          />
        </Field>
        <Field label="소개 문장" hint="블로그 성격을 설명하는 짧은 설명입니다.">
          <textarea
            value={profileDraft.description ?? ''}
            onChange={event => onProfileChange('description', event.target.value)}
            rows={5}
            className={textareaClassName}
          />
        </Field>
        <Field label="사이트 주소" hint="검색엔진용 대표 주소와 사이트맵에 쓰입니다. 비워 두면 SITE_URL 환경변수를 씁니다.">
          <input
            type="url"
            value={profileDraft.siteUrl ?? ''}
            onChange={event => onProfileChange('siteUrl', event.target.value)}
            placeholder="https://blog.example.com"
            className={inputClassName}
          />
        </Field>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">검색 키워드</p>
          <p className="mb-1.5 mt-1 text-[11px] text-[var(--text-muted)]">홈 화면 keywords 메타 태그에 주력 스택과 함께 들어갑니다.</p>
          <TagListInput
            values={profileDraft.keywords ?? []}
            onChange={keywords => onProfileChange('keywords', keywords)}
            emptyPlaceholder="개발, 기술 블로그..."
            morePlaceholder="키워드 추가"
            ariaLabel="검색 키워드"
          />
        </div>
      </div>
    </SectionCard>

    <SectionCard
      eyebrow="정체성"
      title="작성자 정보"
      description="이름, 역할, 연락처 등 프로필 카드에 노출되는 기본 정보를 구성합니다."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="이름">
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={profileDraft.name ?? ''}
              onChange={event => onProfileChange('name', event.target.value)}
              className={`${inputClassName} pl-11`}
            />
          </div>
        </Field>
        <Field label="역할">
          <div className="relative">
            <BriefcaseBusiness className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={profileDraft.role ?? ''}
              onChange={event => onProfileChange('role', event.target.value)}
              className={`${inputClassName} pl-11`}
            />
          </div>
        </Field>
        <Field label="위치">
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={profileDraft.location ?? ''}
              onChange={event => onProfileChange('location', event.target.value)}
              className={`${inputClassName} pl-11`}
            />
          </div>
        </Field>
        <Field label="이메일">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={profileDraft.email ?? ''}
              onChange={event => onProfileChange('email', event.target.value)}
              placeholder="hello@example.com"
              className={`${inputClassName} pl-11`}
            />
          </div>
        </Field>
        <Field
          label="지금 하고 있는 일"
          hint="최근 관심사나 진행 중인 일을 적으면 소개 카드가 더 살아납니다."
          className="sm:col-span-2"
        >
          <textarea
            value={profileDraft.now ?? ''}
            onChange={event => onProfileChange('now', event.target.value)}
            rows={4}
            className={textareaClassName}
          />
        </Field>
      </div>
    </SectionCard>

    <SectionCard
      eyebrow="노출 제어"
      title="자기소개 요소 표시 설정"
      description="홈 헤더와 소개 영역에서 어떤 요소를 보여줄지 토글로 제어합니다."
    >
      <div className="space-y-3">
        {DISPLAY_FIELDS.map(field => {
          const enabled = profileDraft.display[field.key];
          return (
            <div
              key={field.key}
              className="flex items-center justify-between gap-4 rounded-lg border border-[color:var(--border)] bg-[var(--surface-muted)] px-4 py-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text)]">{field.label}</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{field.description}</p>
              </div>
              <button
                type="button"
                onClick={() => onDisplayToggle(field.key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  enabled
                    ? 'bg-[var(--text)] text-[var(--bg)]'
                    : 'border border-[color:var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
                }`}
              >
                {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                {enabled ? '노출 중' : '숨김'}
              </button>
            </div>
          );
        })}
      </div>
    </SectionCard>

    <SectionCard
      eyebrow="이미지"
      title="프로필 자산"
      description="프로필 이미지와 브라우저 탭에 쓰는 파비콘을 함께 관리합니다."
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-start">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-[color:var(--border)] bg-[var(--surface-muted)]">
            {profileDraft.profileImage ? (
              <img src={profileDraft.profileImage} alt="프로필 미리보기" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus size={20} className="text-[var(--text-muted)]" />
            )}
          </div>
          <Field label="프로필 이미지 URL" hint="/avatar.jpg 또는 외부 이미지 주소를 사용할 수 있습니다.">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={profileDraft.profileImage ?? ''}
                onChange={event => onProfileChange('profileImage', event.target.value)}
                placeholder="/avatar.jpg 또는 https://..."
                className={`${inputClassName} mt-0 flex-1`}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={event => onImageUpload(event, 'profileImage')}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-[color:var(--border)] bg-[var(--surface)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition hover:border-[color:var(--accent)] hover:text-[var(--accent-strong)] disabled:opacity-50"
              >
                {uploading ? '업로드 중' : '이미지 업로드'}
              </button>
            </div>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-start">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-[color:var(--border)] bg-[var(--surface-muted)]">
            {profileDraft.favicon ? (
              <img src={profileDraft.favicon} alt="파비콘 미리보기" className="h-10 w-10 rounded-xl object-cover" />
            ) : (
              <Globe size={20} className="text-[var(--text-muted)]" />
            )}
          </div>
          <Field label="파비콘 URL" hint="브라우저 탭과 공유 링크에 쓰이는 기본 아이콘입니다.">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={profileDraft.favicon ?? ''}
                onChange={event => onProfileChange('favicon', event.target.value)}
                placeholder="/avatar.jpg 또는 https://..."
                className={`${inputClassName} mt-0 flex-1`}
              />
              <input
                ref={faviconInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={event => onImageUpload(event, 'favicon')}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => faviconInputRef.current?.click()}
                className="rounded-lg border border-[color:var(--border)] bg-[var(--surface)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition hover:border-[color:var(--accent)] hover:text-[var(--accent-strong)] disabled:opacity-50"
              >
                {uploading ? '업로드 중' : '파비콘 업로드'}
              </button>
            </div>
          </Field>
        </div>
      </div>
    </SectionCard>

    <SectionCard
      eyebrow="노출 포인트"
      title="주력 스택"
      description="홈 소개 카드에 노출할 태그를 관리합니다. 엔터나 쉼표로 빠르게 추가할 수 있습니다."
      className="lg:col-span-2"
    >
      <TagListInput
        values={profileDraft.stack}
        onChange={stack => onProfileChange('stack', stack)}
        emptyPlaceholder="React, TypeScript, AWS..."
        morePlaceholder="스택 추가"
      />
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        현재 {profileDraft.stack.length}개의 스택 태그가 등록되어 있습니다.
      </p>
    </SectionCard>

    <SectionCard
      eyebrow="연결 채널"
      title="소셜 링크"
      description="실제로 응답 가능한 채널 위주로 연결해 두는 편이 운영에 유리합니다."
      className="lg:col-span-2"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {SOCIAL_FIELDS.map(({ key, label, placeholder, icon: Icon }) => (
          <Field key={key} label={label}>
            <div className="relative">
              <Icon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={profileDraft.social[key] ?? ''}
                onChange={event => onProfileSocialChange(key, event.target.value)}
                placeholder={placeholder}
                className={`${inputClassName} pl-11`}
              />
            </div>
          </Field>
        ))}
      </div>
    </SectionCard>
  </div>
);

export default ProfileEditorSections;
