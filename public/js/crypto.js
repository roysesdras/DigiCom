/**
 * DigiCom E2EE Cryptography Engine
 * Uses native browser Web Crypto API (SubtleCrypto)
 * - PBKDF2 (SHA-256, 100,000 iterations) for Key Derivation
 * - AES-GCM 256-bit for authenticated message encryption
 */

class DigiCrypto {
  static strToArrayBuffer(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }

  static arrayBufferToStr(buffer) {
    const decoder = new TextDecoder();
    return decoder.decode(buffer);
  }

  static bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  static base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Derives an AES-GCM 256-bit CryptoKey from a user passphrase and a salt.
   */
  static async deriveKey(passphrase, saltBuffer) {
    const passphraseKey = await window.crypto.subtle.importKey(
      'raw',
      this.strToArrayBuffer(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 100000,
        hash: 'SHA-256'
      },
      passphraseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts plain text using a secret passphrase.
   * Returns an object { ciphertext, iv, salt } (all base64 strings).
   */
  static async encryptMessage(plainText, secretPassphrase) {
    if (!secretPassphrase || secretPassphrase.trim() === '') {
      throw new Error('Passphrase secrète requise pour le chiffrement.');
    }

    // 16-byte random Salt & 12-byte random IV
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const key = await this.deriveKey(secretPassphrase, salt);

    const encodedText = this.strToArrayBuffer(plainText);
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encodedText
    );

    return {
      ciphertext: this.bufferToBase64(encryptedBuffer),
      iv: this.bufferToBase64(iv),
      salt: this.bufferToBase64(salt)
    };
  }

  /**
   * Decrypts an encrypted payload using the secret passphrase.
   * Expects { ciphertext, iv, salt } or a JSON string.
   */
  static async decryptMessage(encryptedData, secretPassphrase) {
    if (!secretPassphrase || secretPassphrase.trim() === '') {
      throw new Error('Passphrase requise');
    }

    let payload = encryptedData;
    if (typeof encryptedData === 'string') {
      try {
        payload = JSON.parse(encryptedData);
      } catch (e) {
        // Plain text fallback if not JSON
        return encryptedData;
      }
    }

    if (!payload.ciphertext || !payload.iv || !payload.salt) {
      // Not encrypted format, return as is
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    }

    try {
      const salt = this.base64ToBuffer(payload.salt);
      const iv = this.base64ToBuffer(payload.iv);
      const ciphertext = this.base64ToBuffer(payload.ciphertext);

      const key = await this.deriveKey(secretPassphrase, salt);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(iv)
        },
        key,
        ciphertext
      );

      return this.arrayBufferToStr(decryptedBuffer);
    } catch (err) {
      console.warn('[-] Decryption failed (wrong passphrase or altered message)');
      return null;
    }
  }
}

// Global export for browser
window.DigiCrypto = DigiCrypto;
