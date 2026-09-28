'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import Image from '@tiptap/extension-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Braces, ImagePlus, Italic, Link2, List, ListOrdered, Loader2 } from 'lucide-react'
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
  /**
   * 'email' composes an email body: no @mentions (an address like
   * "@docusign.net" would open the member picker) and no images (they upload
   * to members-only storage an email client can't load). Adds a formatting
   * toolbar and, when `mergeFields` is given, an "Insert field" menu.
   */
  variant?: 'default' | 'email'
  mergeFields?: readonly { token: string; label: string }[]
}

// Shared TipTap composer for posts and comments. Emits both the JSON doc (stored
// in *_json) and a plain-text projection (stored in *_text for search, FR-COM-09).
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  compact = false,
  editable = true,
  variant = 'default',
  mergeFields,
}: Props) {
  const isEmail = variant === 'email'
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const extensions = useMemo(
    () =>
      isEmail
        ? [StarterKit.configure({ link: { openOnClick: false, autolink: true } })]
        : [
            StarterKit,
            Mention.configure({
              HTMLAttributes: { class: 'rounded bg-brand-blue/10 px-1 font-medium text-brand-blue' },
              suggestion: mentionSuggestion(),
            }),
            Image.configure({ HTMLAttributes: { class: 'rounded-lg max-h-80' } }),
          ],
    [isEmail],
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
          // Emails read as spaced paragraphs; match that while composing.
          isEmail ? '[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li_p]:my-1' : '',
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
      // Bytes go browser → storage via a signed URL; only the path is posted.
      const stored = await uploadDirectToStorage(file, 'community-media')
      if ('error' in stored) {
        alert(stored.error)
        return
      }
      const result = await postUpload(
        '/api/community/media/upload',
        JSON.stringify({ storagePath: stored.storagePath, fileType: stored.fileType }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      if ('error' in result) {
        alert(result.error)
        return
      }
      editor?.chain().focus().setImage({ src: result.data.src as string }).run()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-md border border-brand-border bg-white focus-within:border-brand-border">
      {editable && isEmail && editor && (
        <div className="flex flex-wrap items-center gap-1 border-b border-brand-hairline px-2 py-1">
          {[
            { icon: Bold, title: 'Bold', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
            { icon: Italic, title: 'Italic', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
            { icon: List, title: 'Bulleted list', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
            { icon: ListOrdered, title: 'Numbered list', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
            {
              icon: Link2,
              title: 'Link',
              active: editor.isActive('link'),
              run: () => {
                const prev = editor.getAttributes('link').href as string | undefined
                const href = prompt('Link address (leave empty to remove):', prev ?? 'https://')
                if (href === null) return
                if (!href.trim() || href.trim() === 'https://') editor.chain().focus().extendMarkRange('link').unsetLink().run()
                else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
              },
            },
          ].map(({ icon: Icon, title, active, run }) => (
            <button
              key={title}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={active}
              onClick={run}
              className={`rounded p-1.5 text-brand-muted hover:bg-brand-hairline ${active ? 'bg-brand-hairline text-ink' : ''}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          {mergeFields && mergeFields.length > 0 && (
            <label className="ml-auto flex items-center gap-1 text-xs text-brand-muted-soft">
              <Braces className="h-3.5 w-3.5" aria-hidden />
              <select
                aria-label="Insert merge field"
                value=""
                onChange={(e) => {
                  if (e.target.value) editor.chain().focus().insertContent(`{{${e.target.value}}}`).run()
                }}
                className="rounded border border-brand-border bg-white px-1.5 py-0.5 text-xs text-brand-muted"
              >
                <option value="">Insert field…</option>
                {mergeFields.map((f) => (
                  <option key={f.token} value={f.token}>{f.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {editable && !isEmail && (
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
