import { NextResponse, NextRequest } from 'next/server'

/**
 * Middleware to redirect all requests to /client prefix
 * Ensures consistent routing structure for the application
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // If the path already starts with /client, continue without redirect
  if (pathname.startsWith('/client')) {
    return NextResponse.next()
  }

  // The student-facing Dinee Campus surface is an isolated top-level route
  // group (`src/app/campus/**`), intentionally NOT under the restaurant
  // `/client` prefix, and it has its own API route. Let it serve directly.
  if (pathname.startsWith('/campus')) {
    return NextResponse.next()
  }

  // Redirect to /client prefixed path
  return NextResponse.redirect(new URL(`/client${pathname}`, request.url))
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|campus).*)',
}

