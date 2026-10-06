import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { buildGoogleAuthUrl } from '@/lib/google-client';
import { generateRandomToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const stateToken = `${user.id}:${generateRandomToken(16)}`;
    const authUrl = buildGoogleAuthUrl(stateToken);

    return NextResponse.json({ success: true, authUrl });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
