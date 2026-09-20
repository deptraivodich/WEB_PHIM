/**
 * Utility function to generate URL-friendly SEO slugs from movie titles
 * Converts Vietnamese diacritics to unsigned ASCII, replaces spaces/symbols with hyphens.
 * Example: "Thiếu nữ quái vật caramelise" -> "thieu-nu-quai-vat-caramelise"
 */
export const generateSlug = (title) => {
  if (!title || typeof title !== 'string') return '';

  return title
    .toLowerCase()
    .normalize('NFD') // Tách dấu thanh khỏi ký tự gốc
    .replace(/[\u0300-\u036f]/g, '') // Xóa các ký tự dấu thanh
    .replace(/[đĐ]/g, 'd') // Chuẩn hóa chữ đ/Đ thành d
    .replace(/[^a-z0-9\s-]/g, '') // Xóa các ký tự đặc biệt trừ chữ, số, khoảng trắng và gạch ngang
    .trim()
    .replace(/\s+/g, '-') // Thay thế khoảng trắng bằng dấu gạch ngang
    .replace(/-+/g, '-'); // Xóa các dấu gạch ngang liên tiếp thừa
};
