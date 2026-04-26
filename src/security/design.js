export const UI = {
  errors: {
    fileTooLarge:    'Datei zu groß. Maximum: 15 MB.',
    wrongFileType:   'Ungültiger Dateityp. Erlaubt: JPG, PNG, WebP, HEIC.',
    pathTraversal:   'Ungültiger Dateipfad.',
    rateLimited:     'Zu viele Anfragen. Bitte kurz warten.',
    promptInjection: 'Bild konnte nicht verarbeitet werden.',
    genericError:    'Ein Fehler ist aufgetreten.',
  },

  errorResponse(code, message) {
    return { ok: false, error: { code, message } };
  },

  successResponse(data) {
    return { ok: true, data };
  },
};
