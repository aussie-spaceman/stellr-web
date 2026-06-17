'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { useEffect, useMemo } from 'react'
import type { JSONContent } from '@tiptap/react'
import { mentionSuggestion } from './mention-suggestion'

interface Props {
  /** Controlled value; the parent owns the JSON doc. */
  value: JSONContent | null
  onChange: (doc: JSONContent, plainText: string) => void
  placeholder?: string
  /** Compact styling for inline comment composing. */
  compact?: boolean
  editable?: boolean
}

// Shared TipTap composer for posts and comments. Emits both the JSON doc (stored
// in *_json) and a plain-text projection (stored in *_text for search, FR-COM-09).
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  compact = false,
  editable = true,
}: Props) {
  const extensions = useMemo(
    () => [
      StarterKit,
      Mention.configure({
        HTMLAttributes: { class: 'rounded bg-blue-100 px-1 font-medium text-blue-700' },
        suggestion: mentionSuggestion(),
      }),
    ],
    [],
  )

  const editor = useEditor({
    extensions,
    content: value ?? '',
    editable,
    immediatelyRender: false, // required for Next.js SSR
    editorProps: {
      attributes: {
        class: [
          'prose prose-sm max-w-none focus:outline-none',
          compact ? 'min-h-[60px]' : 'min-h-[140px]',
          'px-3 py-2',
        ].join(' '),
        'data-placeholder': placeholder ?? '',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON(), editor.getText())
    },
  })

  // Reset editor when the parent clears the value (e.g. after submit).
  useEffect(() => {
    if (editor && value === null && !editor.isEmpty) {
      editor.commands.clearContent()
    }
  }, [editor, value])

  return (
    <div className="rounded-md border border-gray-300 bg-white focus-within:border-gray-400">
      <EditorContent editor={editor} />
    </div>
  )
}
