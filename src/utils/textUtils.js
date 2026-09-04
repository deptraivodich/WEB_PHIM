/**
 * textUtils.js - Text normalization utilities with Defensive Fallbacks
 */

/**
 * Formats a Vietnamese title to Sentence Case:
 * Only capitalizes the very first letter of the sentence; the rest is lowercased.
 * Defensive against undefined/null/non-string values.
 * Example: "THẤT NGHIỆP CHUYỂN SINH (PHẦN 3)" -> "Thất nghiệp chuyển sinh (phần 3)"
 * Example: "Chuyến Du Hành Dị Giới Của Nhà Thu Thập Nguyên Liệu" -> "Chuyến du hành dị giới của nhà thu thập nguyên liệu"
 */
export const formatVietnameseSentenceCase = (text) => {
  if (text === null || text === undefined) return 'Phim chưa có tên';
  const str = typeof text === 'string' ? text : String(text);
  const trimmed = str.trim();
  if (!trimmed) return 'Phim chưa có tên';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};
