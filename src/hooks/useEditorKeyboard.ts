import { useEffect, useCallback } from "react";

interface UseEditorKeyboardProps {
  currentPage: number;
  totalPages: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  showFindReplace: boolean;
  setShowFindReplace: (v: boolean) => void;
  quickReviewMode: boolean;
  setQuickReviewMode: (v: boolean) => void;
  quickReviewIndex: number;
  setQuickReviewIndex: React.Dispatch<React.SetStateAction<number>>;
  filteredCount: number;
  hasState: boolean;
}

/**
 * Keyboard shortcuts for the editor:
 * - Ctrl+→ / Ctrl+← : Next/previous page
 * - Ctrl+F : Toggle find & replace
 * - Ctrl+Q : Toggle quick review mode
 * - Escape : Close panels/dialogs
 */
export function useEditorKeyboard({
  currentPage, totalPages, setCurrentPage,
  showFindReplace, setShowFindReplace,
  quickReviewMode, setQuickReviewMode,
  quickReviewIndex, setQuickReviewIndex,
  filteredCount, hasState,
}: UseEditorKeyboardProps) {

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!hasState) return;
    
    // Don't capture if user is typing in an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // Allow Escape to blur from inputs
      if (e.key === 'Escape') {
        target.blur();
        e.preventDefault();
      }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+ArrowRight = Next page
    if (ctrl && e.key === 'ArrowRight') {
      e.preventDefault();
      setCurrentPage(p => Math.min(p + 1, totalPages));
      return;
    }
    // Ctrl+ArrowLeft = Previous page
    if (ctrl && e.key === 'ArrowLeft') {
      e.preventDefault();
      setCurrentPage(p => Math.max(p - 1, 1));
      return;
    }

    // Ctrl+F = Find & Replace
    if (ctrl && e.key === 'f') {
      e.preventDefault();
      setShowFindReplace(!showFindReplace);
      return;
    }

    // Ctrl+Q = Quick Review
    if (ctrl && e.key === 'q') {
      e.preventDefault();
      setQuickReviewMode(!quickReviewMode);
      return;
    }

    // Quick review mode navigation
    if (quickReviewMode) {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setQuickReviewIndex(i => Math.min(i + 1, filteredCount - 1));
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setQuickReviewIndex(i => Math.max(i - 1, 0));
        return;
      }
    }

    // Escape = close panels
    if (e.key === 'Escape') {
      if (showFindReplace) { setShowFindReplace(false); e.preventDefault(); return; }
      if (quickReviewMode) { setQuickReviewMode(false); e.preventDefault(); return; }
    }
  }, [hasState, currentPage, totalPages, setCurrentPage, showFindReplace, setShowFindReplace, quickReviewMode, setQuickReviewMode, quickReviewIndex, setQuickReviewIndex, filteredCount]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
