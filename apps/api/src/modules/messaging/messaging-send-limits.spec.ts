import { describe, expect, it } from 'vitest';
import { countUserVisibleCharacters } from './messaging.service';

describe('countUserVisibleCharacters — đếm grapheme cho trần độ dài tin (M2, #212)', () => {
  it('ASCII thường: đếm như độ dài chuỗi', () => {
    expect(countUserVisibleCharacters('hello')).toBe(5);
    expect(countUserVisibleCharacters('')).toBe(0);
  });

  it('tiếng Việt tổ hợp: chữ + dấu thanh tách rời vẫn là MỘT ký tự', () => {
    expect(countUserVisibleCharacters('e\u0302\u0301')).toBe(1);
    expect(countUserVisibleCharacters('tie\u0302\u0301ng')).toBe(5);
  });

  it('emoji đơn: 1 ký tự dù chiếm 2 đơn vị UTF-16 và 4 byte', () => {
    expect('👍'.length).toBe(2);
    expect(countUserVisibleCharacters('👍')).toBe(1);
    expect(countUserVisibleCharacters('👍👍👍')).toBe(3);
  });

  it('emoji ghép ZWJ (gia đình) là MỘT ký tự', () => {
    const family = '👨‍👩‍👧‍👦';
    expect([...family].length).toBeGreaterThan(1);
    expect(countUserVisibleCharacters(family)).toBe(1);
  });

  it('cờ quốc gia (cặp regional indicator) là MỘT ký tự', () => {
    expect(countUserVisibleCharacters('🇻🇳')).toBe(1);
  });

  it('chuỗi hỗn hợp cộng đúng từng cụm', () => {
    expect(countUserVisibleCharacters('a👍e\u0302\u0301🇻🇳')).toBe(4);
  });
});
