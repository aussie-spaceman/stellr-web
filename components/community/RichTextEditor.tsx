'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import Image from '@tiptap/extension-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
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
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const extensions = useMemo(
    () => [
      StarterKit,
      Mention.configure({
        HTMLAttributes: { class: 'rounded bg-brand-blue/10 px-1 font-medium text-brand-blue' },
        suggestion: mentionSuggestion(),
      }),
      Image.configure({ HTMLAttributes: { class: 'rounded-lg max-h-80' } }),
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

  const uploadImage = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/community/media/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (res.ok && json.src) {
        editor?.chain().focus().setImage({ src: json.src }).run()
      } else {
        alert(json.error ?? 'Image upload failed')
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-md border border-brand-border bg-white focus-within:border-brand-border">
      {editable && (
        <div className="flex items-center gap-1 border-b border-brand-hairline px-2 py-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Add image"
            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-brand-muted-soft hover:bg-brand-hairline disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadImage(f)
              e.target.value = ''
            }}
          />
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
