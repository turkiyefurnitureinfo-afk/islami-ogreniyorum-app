import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Linking, ActivityIndicator, Image } from 'react-native';
import { TranslateButton } from './useTranslate.js';
import { useCachedAvatar } from './avatarCache.js';

/**
 * Shows a user's profile picture when available, otherwise the emoji avatar.
 * The picture is rendered from the on-disk avatar cache when possible, so it
 * survives offline; the emoji only appears when no picture exists at all.
 * Used for answer rows in both question lists.
 */
const UserAvatar = ({ avatarUrl, avatar, style }) => {
  const cached = useCachedAvatar(avatarUrl);
  const src = cached || avatarUrl;
  const [errored, setErrored] = useState(false);
  if (src) {
    if (errored) setErrored(false);
    return (
      <Image
        source={{ uri: src }}
        style={style}
        onError={() => setErrored(true)}
      />
    );
  }
  // No source at all (genuinely no avatar) → emoji fallback.
  if (!avatarUrl) {
    return <Text style={[style, stylesFallbackText]}>{avatar || '👤'}</Text>;
  }
  // URL exists but the image failed to load (offline + uncached) → neutral
  // placeholder, NOT the user's emoji. The emoji is reserved for "no picture".
  return (
    <View style={style}>
      <Text style={{ fontSize: 16, opacity: 0.4 }}>👤</Text>
    </View>
  );
};
// The emoji fallback keeps the original text styling (font-size based) — the
// passed-in style is a fixed-size image style, so layer a text style under it.
const stylesFallbackText = { fontSize: 18 };


const QATab = ({
  styles,
  palette,
  t,
  language,
  qAndA,
  expandedQas,
  setExpandedQas,
  newQuestion,
  setNewQuestion,
  handleAskQuestion,
  postingQuestion,
  handleLikeQuestion,
  handleLikeAnswer,
  newAnswer,
  setNewAnswer,
  handleSubmitAnswer,
  answerFormOpen,
  setAnswerFormOpen,
  handleAIAnswer,
  account,
  profilePicture,
  handleEditQuestion,
  handleDeleteQuestion,
  handleEditAnswer,
  handleDeleteAnswer,
  onReport,
}) => {
  // Inline edit state: only one field is edited at a time.
  const [editKey, setEditKey] = useState(null); // e.g. 'q-123' or 'a-456'
  const [draftText, setDraftText] = useState('');

  const isOwn = (ownerEmail) =>
    !!ownerEmail && !!account?.email && ownerEmail === account.email;

  const startEdit = (key, currentText) => {
    setEditKey(key);
    setDraftText(currentText);
  };

  const cancelEdit = () => {
    setEditKey(null);
    setDraftText('');
  };

  /**
   * Renders ✏️ Edit / 🗑 Delete controls for the user's own content, or the
   * inline edit form when that item is being edited. Returns null otherwise.
   */
  const renderOwnerControls = (key, ownerEmail, originalText, onSave, onDelete) => {
    if (!isOwn(ownerEmail)) return null;
    if (editKey === key) {
      return (
        <View>
          <TextInput
            style={styles.contentEditInput}
            value={draftText}
            onChangeText={setDraftText}
            multiline
            autoFocus
          />
          <View style={styles.contentEditBtnRow}>
            <Pressable
              style={styles.contentEditSaveBtn}
              onPress={() => { onSave(draftText); cancelEdit(); }}
            >
              <Text style={styles.contentEditSaveText}>{t?.save || 'Save'}</Text>
            </Pressable>
            <Pressable style={styles.contentEditCancelBtn} onPress={cancelEdit}>
              <Text style={styles.contentEditCancelText}>{t?.cancel || 'Cancel'}</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.contentActionRow}>
        <Pressable onPress={() => startEdit(key, originalText)}>
          <Text style={styles.contentActionEdit}>✏️ {t?.edit || 'Edit'}</Text>
        </Pressable>
        <Pressable onPress={onDelete}>
          <Text style={styles.contentActionDelete}>🗑 {t?.delete || 'Delete'}</Text>
        </Pressable>
      </View>
    );
  };

  // Moderation: hand the item up to App's confirm dialog (report / block).
  const reportQuestion = (item) => onReport?.({
    contentType: 'question',
    contentId: item.serverPostId || item.id,
    authorEmail: item.ownerEmail,
  });
  const reportAnswer = (question, ans) => onReport?.({
    contentType: 'answer',
    contentId: ans.serverContribId || ans.id,
    authorEmail: ans.ownerEmail,
  });

  // Prevent crash if qAndA is not an array.
  if (!Array.isArray(qAndA)) {
    return (
      <ScrollView contentContainerStyle={styles.contentPadding}>
        <Text style={styles.qaEmptyState}>{t?.noQuestionsYet || 'No questions yet. Ask the first question!'}</Text>
      </ScrollView>
    );
  }

  // Find top 2 most-liked questions for the "Most Asked" section.
  // Ids can be numeric (local) or strings ('srv-…', server) — compare safely.
  const cmpNewestFirst = (a, b) => {
    if (typeof a.id === 'number' && typeof b.id === 'number') return b.id - a.id;
    return String(b.id).localeCompare(String(a.id));
  };
  const mostAsked = [...qAndA].sort((a, b) => b.likes - a.likes).slice(0, 2);
  const mostAskedIds = mostAsked.map(q => q.id);
  // Filter out most-asked questions and sort the rest by date (newest first).
  const restQuestions = qAndA.filter(q => !mostAskedIds.includes(q.id)).sort(cmpNewestFirst);

  return (
    <ScrollView contentContainerStyle={styles.contentPadding}>
      {/* Ask a new question */}
      <View style={styles.qaAskCard}>
        <Text style={styles.qaAskTitle}>{t?.askQuestion || 'Ask a Question'}</Text>
        <TextInput
          style={styles.input}
          placeholder={t?.yourQuestionPlaceholder || 'Type your question here...'}
          placeholderTextColor={palette.muted}
          value={newQuestion}
          onChangeText={setNewQuestion}
          multiline
          // Pressing enter posts the question, which auto-triggers the AI
          // answer (submitBehavior replaces blurOnSubmit on RN 0.79+).
          submitBehavior="submit"
          onSubmitEditing={handleAskQuestion}
        />
        <Pressable
          style={[styles.button, postingQuestion && styles.disabledButton]}
          onPress={handleAskQuestion}
          disabled={postingQuestion}
        >
          {postingQuestion ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#08131a" style={{ marginRight: 8 }} />
              <Text style={styles.buttonText}>{t?.postingQuestion || 'Posting...'}</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>{t?.postQuestion || 'Post Question'}</Text>
          )}
        </Pressable>
      </View>

      {/* Most Asked Questions */}
      {mostAsked.length > 0 && (
        <View style={styles.qaMostAskedSection}>
          <Text style={styles.qaMostAskedTitle}>🔥 {t?.mostAsked || 'Most Asked'}</Text>
          {mostAsked.map((item) => (
            <Pressable
              key={item.id}
              style={styles.qaMostAskedCard}
              onPress={() => setExpandedQas((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
            >
              <Text style={styles.qaMostAskedBadge}>⭐ {t?.mostAsked || 'Most Asked'}</Text>
              <View style={styles.qRow}>
                <View style={styles.sparkDot}><Text style={styles.sparkText}>✦</Text></View>
                <Text style={styles.qText}>{item.question}</Text>
                <Text style={styles.expandText}>{expandedQas[item.id] ? '−' : '+'}</Text>
              </View>
              <TranslateButton text={item.question} t={t} uiLang={language} />

              <View style={styles.qaLikesRow}>
                <Pressable onPress={() => handleLikeQuestion(item.id)}>
                  <Text style={[styles.qaLikeButton, item.likedByMe && styles.qaLikeButtonLiked]}>
                    {item.likedByMe ? '❤️' : '🤍'} {item.likes} {t?.likes || 'likes'}
                  </Text>
                </Pressable>
                <Text style={styles.qaAnswerCount}>
                  {item.answers?.length || 0} {t?.answerCount || 'answers'}
                </Text>
                {!isOwn(item.ownerEmail) && (
                  <Pressable onPress={() => reportQuestion(item)} hitSlop={8}>
                    <Text style={styles.contentActionDelete}>⚑</Text>
                  </Pressable>
                )}
              </View>

              {renderOwnerControls(
                'q-' + item.id,
                item.ownerEmail,
                item.question,
                (text) => handleEditQuestion(item.id, text),
                () => handleDeleteQuestion(item.id)
              )}

              {expandedQas[item.id] && (
                <View style={styles.answerWrap}>
                  <Text style={styles.answerText}>{item.answer}</Text>
                  <Pressable style={styles.referenceButton} onPress={() => Linking.openURL(item.href)}>
                    <Text style={styles.referenceButtonText}>{t.reference}{item.source}</Text>
                  </Pressable>

                  {/* AI Answer button — hidden once the AI has answered (the
                      answer is generated automatically when the question is
                      posted). Stays visible after a failure so it doubles as
                      the retry button. */}
                  {!item.aiAnswer && (
                    <Pressable
                      style={[styles.aiAnswerButton, item.aiAnswerLoading && styles.disabledButton]}
                      onPress={() => handleAIAnswer(item.id)}
                      disabled={item.aiAnswerLoading}
                    >
                      {item.aiAnswerLoading ? (
                        <View style={styles.aiAnswerLoadingRow}>
                          <ActivityIndicator size="small" color={palette.muted} />
                          <Text style={styles.aiAnswerButtonText}>
                            {t?.aiThinking || 'AI is thinking...'}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.aiAnswerButtonText}>
                          {t?.aiAskAnswer || '🤖 Ask AI for an answer'}
                        </Text>
                      )}
                    </Pressable>
                  )}

                  {item.aiError && (
                    <Text style={styles.aiErrorText}>{item.aiError}</Text>
                  )}

                  {/* Fallback to web search if AI fails */}
                  {item.aiFallbackUrl && (
                    <Pressable style={styles.fallbackButton} onPress={() => Linking.openURL(item.aiFallbackUrl)}>
                      <Text style={styles.fallbackButtonText}>
                        {t?.searchWeb || 'Search on Web'}
                      </Text>
                    </Pressable>
                  )}

                  {/* AI answer badge (if AI already answered) */}
                  {item.aiAnswer && (
                    <View style={styles.aiBadgeWrap}>
                      <Text style={styles.aiBadge}>
                        {item.aiAnswer.aiProvider === 'gemini' ? '✨ Gemini' : item.aiAnswer.aiProvider === 'firebase-ai' ? '✨ Gemini (Firebase AI)' : item.aiAnswer.aiProvider === 'google' ? '🔎 Google' : item.aiAnswer.aiProvider === 'openai' ? '✨ OpenAI' : '🤖 AI Assistant'}
                      </Text>
                    </View>
                  )}

                  {/* Answers section */}
                  <View style={styles.qaAnswersSection}>
                    {item.answers && item.answers.length > 0 ? (
                      item.answers.map((ans) => (
                        <View key={ans.id} style={[styles.qaAnswerItem, ans.isAI && styles.aiContribution]}>
                          <View style={styles.qaAnswerHeader}>
                            <UserAvatar
                              avatarUrl={ans.user.avatarUrl}
                              avatar={ans.user.avatar}
                              style={[styles.qaAnswerAvatar, styles.qaAvatarImage]}
                            />
                            <View>
                              <Text style={styles.qaAnswerUser}>{ans.user.name}</Text>
                              <Text style={styles.qaAnswerTime}>{ans.timestamp}</Text>
                            </View>
                          </View>
                          <Text style={styles.qaAnswerText}>{ans.text}</Text>
                          <TranslateButton text={ans.text} t={t} uiLang={language} />
                          <View style={styles.qaAnswerFooter}>
                            <Text style={styles.qaAnswerTime}>{ans.timestamp}</Text>
                            <Pressable onPress={() => handleLikeAnswer(item.id, ans.id)}>
                              <Text style={[styles.qaAnswerLike, ans.likedByMe && styles.qaAnswerLikeLiked]}>
                                {ans.likedByMe ? '❤️' : '🤍'} {ans.likes}
                              </Text>
                            </Pressable>
                            {!isOwn(ans.ownerEmail) && (
                              <Pressable onPress={() => reportAnswer(item, ans)} hitSlop={8}>
                                <Text style={styles.contentActionDelete}>⚑</Text>
                              </Pressable>
                            )}
                          </View>
                          {renderOwnerControls(
                            'a-' + ans.id,
                            ans.ownerEmail,
                            ans.text,
                            (text) => handleEditAnswer(item.id, ans.id, text),
                            () => handleDeleteAnswer(item.id, ans.id)
                          )}
                        </View>
                      ))
                    ) : (
                      <Text style={styles.qaNoAnswers}>{t?.noAnswersYet || 'No answers yet. Be the first to answer!'}</Text>
                    )}

                    {/* Add answer form */}
                    {answerFormOpen[item.id] ? (
                      <View style={styles.qaAnswerForm}>
                        <TextInput
                          style={styles.qaAnswerInput}
                          placeholder={t?.yourAnswerPlaceholder || 'Write your answer...'}
                          placeholderTextColor={palette.muted}
                          value={newAnswer[item.id] || ''}
                          onChangeText={(text) => setNewAnswer((prev) => ({ ...prev, [item.id]: text }))}
                          multiline
                        />
                        <Pressable style={styles.qaAnswerSubmit} onPress={() => handleSubmitAnswer(item.id)}>
                          <Text style={styles.qaAnswerSubmitText}>{t?.submitAnswer || 'Submit Answer'}</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable style={styles.qaAddAnswerButton} onPress={() => setAnswerFormOpen((prev) => ({ ...prev, [item.id]: true }))}>
                        <Text style={styles.qaAddAnswerButtonText}>✍️ {t?.addAnswer || 'Write an Answer'}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}

      {/* All Questions */}
      <Text style={styles.qaAllQuestionsTitle}>{t?.allQuestions || 'All Questions'}</Text>
      {restQuestions.map((item) => {
        const expanded = !!expandedQas[item.id];
        return (
          <Pressable key={item.id} style={styles.essayCard} onPress={() => setExpandedQas((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}>
            <View style={styles.qRow}>
              <View style={styles.sparkDot}><Text style={styles.sparkText}>✦</Text></View>
              <Text style={styles.qText}>{item.question}</Text>
              <Text style={styles.expandText}>{expanded ? '−' : '+'}</Text>
            </View>
            <TranslateButton text={item.question} t={t} uiLang={language} />

            <View style={styles.qaLikesRow}>
              <Pressable onPress={() => handleLikeQuestion(item.id)}>
                <Text style={[styles.qaLikeButton, item.likedByMe && styles.qaLikeButtonLiked]}>
                  {item.likedByMe ? '❤️' : '🤍'} {item.likes} {t?.likes || 'likes'}
                </Text>
              </Pressable>
              <Text style={styles.qaAnswerCount}>
                {item.answers?.length || 0} {t?.answerCount || 'answers'}
              </Text>
              {!isOwn(item.ownerEmail) && (
                <Pressable onPress={() => reportQuestion(item)} hitSlop={8}>
                  <Text style={styles.contentActionDelete}>⚑</Text>
                </Pressable>
              )}
            </View>

            {renderOwnerControls(
              'q-' + item.id,
              item.ownerEmail,
              item.question,
              (text) => handleEditQuestion(item.id, text),
              () => handleDeleteQuestion(item.id)
            )}

            {expanded && (
              <View style={styles.answerWrap}>
                <Text style={styles.answerText}>{item.answer}</Text>
                <Pressable style={styles.referenceButton} onPress={() => Linking.openURL(item.href)}>
                  <Text style={styles.referenceButtonText}>{t.reference}{item.source}</Text>
                </Pressable>

                {/* AI Answer button — hidden once the AI has answered (the
                    answer is generated automatically when the question is
                    posted). Stays visible after a failure so it doubles as
                    the retry button. */}
                {!item.aiAnswer && (
                  <Pressable
                    style={[styles.aiAnswerButton, item.aiAnswerLoading && styles.disabledButton]}
                    onPress={() => handleAIAnswer(item.id)}
                    disabled={item.aiAnswerLoading}
                  >
                    {item.aiAnswerLoading ? (
                      <View style={styles.aiAnswerLoadingRow}>
                        <ActivityIndicator size="small" color={palette.muted} />
                        <Text style={styles.aiAnswerButtonText}>
                          {t?.aiThinking || 'AI is thinking...'}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.aiAnswerButtonText}>
                        {t?.aiAskAnswer || '🤖 Ask AI for an answer'}
                      </Text>
                    )}
                  </Pressable>
                )}

                {item.aiError && (
                  <Text style={styles.aiErrorText}>{item.aiError}</Text>
                )}

                {/* Fallback to web search if AI fails */}
                {item.aiFallbackUrl && (
                  <Pressable style={styles.fallbackButton} onPress={() => Linking.openURL(item.aiFallbackUrl)}>
                    <Text style={styles.fallbackButtonText}>
                      {t?.searchWeb || 'Search on Web'}
                    </Text>
                  </Pressable>
                )}

                {/* AI answer badge (if AI already answered) */}
                {item.aiAnswer && (
                  <View style={styles.aiBadgeWrap}>
                    <Text style={styles.aiBadge}>
                      {item.aiAnswer.aiProvider === 'gemini' ? '✨ Gemini' : item.aiAnswer.aiProvider === 'firebase-ai' ? '✨ Gemini (Firebase AI)' : item.aiAnswer.aiProvider === 'google' ? '🔎 Google' : item.aiAnswer.aiProvider === 'openai' ? '✨ OpenAI' : '🤖 AI Assistant'}
                    </Text>
                  </View>
                )}

                {/* Answers section */}
                <View style={styles.qaAnswersSection}>
                  {item.answers && item.answers.length > 0 ? (
                    item.answers.map((ans) => (
                      <View key={ans.id} style={[styles.qaAnswerItem, ans.isAI && styles.aiContribution]}>
                        <View style={styles.qaAnswerHeader}>
                          <UserAvatar
                            avatarUrl={ans.user.avatarUrl}
                            avatar={ans.user.avatar}
                            style={[styles.qaAnswerAvatar, styles.qaAvatarImage]}
                          />
                          <View>
                            <Text style={styles.qaAnswerUser}>{ans.user.name}</Text>
                            <Text style={styles.qaAnswerTime}>{ans.timestamp}</Text>
                          </View>
                        </View>
                        <Text style={styles.qaAnswerText}>{ans.text}</Text>
                        <TranslateButton text={ans.text} t={t} uiLang={language} />
                        <View style={styles.qaAnswerFooter}>
                          <Text style={styles.qaAnswerTime}>{ans.timestamp}</Text>
                          <Pressable onPress={() => handleLikeAnswer(item.id, ans.id)}>
                            <Text style={[styles.qaAnswerLike, ans.likedByMe && styles.qaAnswerLikeLiked]}>
                              {ans.likedByMe ? '❤️' : '🤍'} {ans.likes}
                            </Text>
                          </Pressable>
                          {!isOwn(ans.ownerEmail) && (
                            <Pressable onPress={() => reportAnswer(item, ans)} hitSlop={8}>
                              <Text style={styles.contentActionDelete}>⚑</Text>
                            </Pressable>
                          )}
                        </View>
                        {renderOwnerControls(
                          'a-' + ans.id,
                          ans.ownerEmail,
                          ans.text,
                          (text) => handleEditAnswer(item.id, ans.id, text),
                          () => handleDeleteAnswer(item.id, ans.id)
                        )}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.qaNoAnswers}>{t?.noAnswersYet || 'No answers yet. Be the first to answer!'}</Text>
                  )}

                  {/* Add answer form */}
                  {answerFormOpen[item.id] ? (
                    <View style={styles.qaAnswerForm}>
                      <TextInput
                        style={styles.qaAnswerInput}
                        placeholder={t?.yourAnswerPlaceholder || 'Write your answer...'}
                        placeholderTextColor={palette.muted}
                        value={newAnswer[item.id] || ''}
                        onChangeText={(text) => setNewAnswer((prev) => ({ ...prev, [item.id]: text }))}
                        multiline
                      />
                      <Pressable style={styles.qaAnswerSubmit} onPress={() => handleSubmitAnswer(item.id)}>
                        <Text style={styles.qaAnswerSubmitText}>{t?.submitAnswer || 'Submit Answer'}</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable style={styles.qaAddAnswerButton} onPress={() => setAnswerFormOpen((prev) => ({ ...prev, [item.id]: true }))}>
                      <Text style={styles.qaAddAnswerButtonText}>✍️ {t?.addAnswer || 'Write an Answer'}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </Pressable>
        );
      })}

      {qAndA?.length === 0 && (
        <Text style={styles.qaEmptyState}>{t?.noQuestionsYet || 'No questions yet. Ask the first question!'}</Text>
      )}
    </ScrollView>
  );
};

export default QATab;