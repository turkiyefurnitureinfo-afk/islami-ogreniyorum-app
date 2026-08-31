import { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { translateText, looksLikeTurkish } from './aiLogic.js';

// ---------------------------------------------------------------------------
// Community translation — reuse the same Gemini model used for AI answers.
// Turkish ↔ English so every user can read every post regardless of language.
// ---------------------------------------------------------------------------

/**
 * Hook to manage translation state for a single piece of text.
 * Returns the button renderer + state so any component can add a
 * "🌐 Translate" toggle to any text block.
 *
 * @param {string} originalText - the original text to translate
 */
export function useTranslate(originalText) {
  const [translation, setTranslation] = useState(null); // { translated, sourceLang, targetLang } | null
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTranslation, setShowTranslation] = useState(false);

  const handleTranslate = useCallback(async () => {
    // If we already have the translation, just toggle visibility.
    if (translation) {
      setShowTranslation((v) => !v);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await translateText(originalText);
      setTranslation(result);
      setShowTranslation(true);
    } catch (err) {
      setError(err?.message || 'Translation failed');
    } finally {
      setLoading(false);
    }
  }, [originalText, translation]);

  const toggle = useCallback(() => {
    setShowTranslation((v) => !v);
  }, []);

  return {
    translation,
    loading,
    error,
    showTranslation,
    handleTranslate,
    toggle,
  };
}

/**
 * Self-contained "Translate" button + translated text block.
 * Drop this below any piece of text in the Q&A or Community tabs to give
 * users a one-tap Turkish ↔ English toggle.
 *
 * Props:
 *   text          - the original (untranslated) string
 *   t             - the tab's translation helper (t?.translate etc.)
 *   textStyle     - optional style for the translated text
 *   containerStyle- optional style for the outer wrapper
 */
export function TranslateButton({ text, t, uiLang }) {
  const { translation, loading, error, showTranslation, handleTranslate, toggle } = useTranslate(text);

  if (!text || typeof text !== 'string' || text.trim().length < 2) return null;
  // Only offer translation when the text is in the OTHER language: a Turkish
  // reader doesn't need a translate button on Turkish content (and likewise
  // for English readers on English content). uiLang is the reader's UI
  // language ('tr' | 'en'); omitted → button always shows (old behaviour).
  if (uiLang && (looksLikeTurkish(text) ? 'tr' : 'en') === uiLang) return null;

  return (
    <TranslateButtonView>
      <TranslateButtonPressable onPress={handleTranslate} hitSlop={6}>
        <TranslateButtonText>
          {loading
            ? (t?.translating || 'Translating...')
            : showTranslation
            ? (t?.hideTranslation || '🌐 Hide translation')
            : (t?.translate || '🌐 Translate')}
        </TranslateButtonText>
      </TranslateButtonPressable>

      {loading && <ActivityIndicator size="small" color="#5b6c8f" style={{ marginTop: 4 }} />}

      {error && !loading && (
        <TranslateError onPress={handleTranslate} hitSlop={6}>
          <TranslateErrorText>⚠️ {error} — {t?.tapToRetry || 'tap to retry'}</TranslateErrorText>
        </TranslateError>
      )}

      {showTranslation && translation && (
        <TranslatedTextView>
          <TranslatedTextBadge>
            🌐 {translation.sourceLang === 'tr'
              ? (t?.translatedFromTr || 'Translated from Turkish')
              : (t?.translatedFromEn || 'Translated from English')}
          </TranslatedTextBadge>
          <TranslatedTextContent>{translation.translated}</TranslatedTextContent>
          <TranslatedTextOriginal onPress={toggle} hitSlop={6}>
            <TranslatedTextOriginalText>{t?.showOriginal || 'Show original'}</TranslatedTextOriginalText>
          </TranslatedTextOriginal>
        </TranslatedTextView>
      )}
    </TranslateButtonView>
    );
}

// ---------------------------------------------------------------------------
// Shared styles (no external stylesheet dependency)
// ---------------------------------------------------------------------------
const TranslateButtonView = ({ children }) => <View style={{ marginTop: 6 }}>{children}</View>;

const TranslateButtonPressable = ({ onPress, hitSlop, children }) => (
  <Pressable
    onPress={onPress}
    hitSlop={hitSlop}
    style={{
      backgroundColor: '#e8f0fe',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      alignSelf: 'flex-start',
    }}
  >
    {children}
  </Pressable>
);

const TranslateButtonText = ({ children }) => (
  <Text style={{ color: '#1a73e8', fontSize: 12, fontWeight: '600' }}>{children}</Text>
);

const TranslateError = ({ onPress, hitSlop, children }) => (
  <Pressable onPress={onPress} hitSlop={hitSlop} style={{ marginTop: 4 }}>
    {children}
  </Pressable>
);

const TranslateErrorText = ({ children }) => (
  <Text style={{ color: '#e05d5d', fontSize: 12 }}>{children}</Text>
);

const TranslatedTextView = ({ children }) => (
  <View style={{ marginTop: 6, backgroundColor: '#f0f4ff', borderRadius: 8, padding: 10 }}>
    {children}
  </View>
);

const TranslatedTextBadge = ({ children }) => (
  <Text style={{ fontSize: 11, color: '#5b6c8f', marginBottom: 4, fontWeight: '600' }}>
    {children}
  </Text>
);

const TranslatedTextContent = ({ children }) => (
  <Text style={{ fontSize: 14, color: '#1a2b45', lineHeight: 20 }}>{children}</Text>
);

const TranslatedTextOriginal = ({ onPress, hitSlop, children }) => (
  <Pressable onPress={onPress} hitSlop={hitSlop} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
    {children}
  </Pressable>
);

const TranslatedTextOriginalText = ({ children }) => (
  <Text style={{ color: '#1a73e8', fontSize: 12, fontWeight: '500' }}>{children}</Text>
);
