import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * DELETE /api/items/[id] — owner-only delete. RLS already enforces
 * user_id = auth.uid(); we additionally guard with an explicit eq filter
 * so a successful response can't leak that an unrelated id exists.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { error, count } = await supabase
    .from('items')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('user_id', userRes.user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if ((count ?? 0) === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
