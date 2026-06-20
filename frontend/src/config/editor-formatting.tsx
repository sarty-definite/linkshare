import React from 'react';
import { Editor } from '@tiptap/react';

export interface FormattingAction {
  title: string;
  label: React.ReactNode;
  isActive: (editor: Editor) => boolean;
  action: (editor: Editor) => void;
}

export const formattingActions: FormattingAction[] = [
  {
    title: 'Bold',
    label: <strong>B</strong>,
    isActive: (editor) => editor.isActive('bold'),
    action: (editor) => editor.chain().focus().toggleBold().run()
  },
  {
    title: 'Italic',
    label: <em>I</em>,
    isActive: (editor) => editor.isActive('italic'),
    action: (editor) => editor.chain().focus().toggleItalic().run()
  },
  {
    title: 'Underline',
    label: <u>U</u>,
    isActive: (editor) => editor.isActive('underline'),
    action: (editor) => editor.chain().focus().toggleUnderline().run()
  },
  {
    title: 'Heading 1',
    label: 'H₁',
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run()
  },
  {
    title: 'Heading 2',
    label: 'H₂',
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()
  },
  {
    title: 'Bullet List',
    label: '•',
    isActive: (editor) => editor.isActive('bulletList'),
    action: (editor) => editor.chain().focus().toggleBulletList().run()
  },
  {
    title: 'Numbered List',
    label: '1.',
    isActive: (editor) => editor.isActive('orderedList'),
    action: (editor) => editor.chain().focus().toggleOrderedList().run()
  },
  {
    title: 'Insert Table',
    label: '田',
    isActive: () => false,
    action: (editor) => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
  },
  {
    title: 'Line Break',
    label: '↵',
    isActive: () => false,
    action: (editor) => editor.chain().focus().setHardBreak().run()
  },
  {
    title: 'Insert Link',
    label: '🔗',
    isActive: (editor) => editor.isActive('link'),
    action: (editor) => {
      const href = window.prompt('Enter link URL');
      if (href !== null) {
        editor.chain().focus().setLink({ href }).run();
      }
    }
  }
];
