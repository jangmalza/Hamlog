import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { markdownToEditorHtml, shouldConvertMarkdownPaste } from '../utils/markdownPaste';

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    // Ctrl/Cmd+Shift+V keeps the pasted Markdown as plain text.
    let plainPasteRequested = false;

    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handleKeyDown(_view, event) {
            plainPasteRequested = event.shiftKey
              && (event.ctrlKey || event.metaKey)
              && event.key.toLowerCase() === 'v';
            return false;
          },
          handlePaste(view, event) {
            const plainPaste = plainPasteRequested;
            plainPasteRequested = false;
            const data = event.clipboardData;
            if (plainPaste || !data || data.files.length > 0) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;

            const text = data.getData('text/plain');
            if (!shouldConvertMarkdownPaste({
              text,
              html: data.getData('text/html'),
              vscodeEditorData: data.getData('vscode-editor-data')
            })) {
              return false;
            }

            event.preventDefault();
            // Reuse ProseMirror's HTML paste path so the result is parsed by the
            // schema and recorded as one paste like any rich-text paste. The
            // synthetic event has no clipboard data, so this handler skips it.
            return view.pasteHTML(markdownToEditorHtml(text));
          }
        }
      })
    ];
  }
});
