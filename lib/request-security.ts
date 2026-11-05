export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')

  if (!origin) return process.env.NODE_ENV !== 'production'
  if (!host) return false

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}
