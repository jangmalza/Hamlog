import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import LinkExtension from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextStyle } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Typography from '@tiptap/extension-typography';
import { createLowlight, common } from 'lowlight';

import { SlashCommand, renderItems } from './extensions/slashCommand';
import { FontSize } from './extensions/fontSize';
import { MathExtension } from '../components/editor/extensions/MathExtension';
import { MermaidExtension } from '../components/editor/extensions/MermaidExtension';
import { ImageGallery } from '../components/editor/extensions/ImageGallery';
import { LinkCard } from './extensions/LinkCard';
import { CustomImage } from './extensions/CustomImage';
import { Columns, Column } from './extensions/Column';
import { MarkdownPaste } from './extensions/MarkdownPaste';
import { getSuggestionItems } from './slashCommands/registry';
import { EDITOR_HEADING_LEVELS, EDITOR_TEXT_ALIGN_TYPES } from '../utils/editorConstants';

const lowlight = createLowlight(common);

export const getEditorExtensions = () => [
    StarterKit.configure({
        heading: {
            levels: [...EDITOR_HEADING_LEVELS]
        },
        codeBlock: false,
        link: false,
        underline: false,
        trailingNode: false
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    FontSize,
    Underline,
    LinkExtension.configure({
        openOnClick: false
    }),
    CustomImage,
    Placeholder.configure({
        placeholder: ({ editor }) => editor.isEmpty
            ? '내용을 입력하세요. /로 블록 추가'
            : '/로 블록 추가',
        showOnlyCurrent: true
    }),
    TextAlign.configure({
        types: EDITOR_TEXT_ALIGN_TYPES
    }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    SlashCommand.configure({
        suggestion: {
            items: getSuggestionItems,
            render: renderItems,
        },
    }),
    MathExtension,
    MermaidExtension,
    Typography,
    ImageGallery,
    Youtube.configure({
        controls: false,
    }),
    LinkCard,
    Columns,
    Column,
    MarkdownPaste
];
