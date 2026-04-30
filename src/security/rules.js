export const RULES = {
  upload: {
    maxFileSizeMb:    15,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    maxImagesPerRun:  50,
  },
  rateLimit: {
    windowMs:              60_000,
    maxRequestsPerWindow:  30,
    maxKiCallsPerDay:      200,
  },
  promptInjection: {
    forbiddenPatterns: [
      /ignore\s+previous\s+instructions/i,
      /you\s+are\s+now\s+a/i,
      /system\s*:\s*you/i,
      /<\s*script[\s>]/i,
      /\bSELECT\b.+\bFROM\b/i,
      /\bDROP\s+TABLE\b/i,
      /\{\{.*\}\}/,
    ],
  },
  filePath: {
    allowedBaseDir:    'runs',
    forbiddenSegments: ['..', '~', '%2e%2e', '%252e', '\0'],
  },
  headers: {
    'X-Content-Type-Options':  'nosniff',
    'X-Frame-Options':         'DENY',
    'X-XSS-Protection':        '1; mode=block',
    'Referrer-Policy':         'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
  },
};
