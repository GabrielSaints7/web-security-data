// frontend/src/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { CryptoService } from "../services/crypto.service";

interface User {
  id: string;
  name: string;
  email: string;
  publicKey: string;
}

interface AuthContextType {
  user: User | null;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  publicKeyRaw: ArrayBuffer | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    phone: string,
    password: string
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);
  const [publicKeyRaw, setPublicKeyRaw] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    // Recuperar do localStorage
    const savedUser = localStorage.getItem("user");
    const savedPrivateKeyJWK = localStorage.getItem("privateKeyJWK");

    if (savedUser && savedPrivateKeyJWK) {
      (async () => {
        try {
          const user = JSON.parse(savedUser);
          const privateKeyJWK = JSON.parse(savedPrivateKeyJWK);

          console.log(" [AUTH] Recuperando chaves do localStorage...");

          // Importar chave privada
          const privKey = await crypto.subtle.importKey(
            "jwk",
            privateKeyJWK,
            {
              name: "ECDH",
              namedCurve: "P-256",
            },
            true,
            ["deriveKey", "deriveBits"]
          );

          // Derivar chave pública da chave privada não é direto,
          // então vamos armazenar a chave pública também
          const publicKeyRawB64 = user.publicKey;
          const pubKeyRaw = CryptoService.base64ToArrayBuffer(publicKeyRawB64);
          const pubKey = await CryptoService.importPublicKey(pubKeyRaw);

          console.log("[AUTH] Chaves recuperadas do localStorage");

          setUser(user);
          setPrivateKey(privKey);
          setPublicKey(pubKey);
          setPublicKeyRaw(pubKeyRaw);
        } catch (error) {
          console.error("[AUTH] Erro ao recuperar chaves:", error);
          // Limpar dados corrompidos
          localStorage.removeItem("user");
          localStorage.removeItem("privateKeyJWK");
        }
      })();
    }
  }, []);

  const register = async (
    name: string,
    email: string,
    phone: string,
    password: string
  ) => {
    console.log("📝 [AUTH] Iniciando registro...");

    try {
      // Gerar par de chaves ECDH
      const keys = await CryptoService.generateKeyPair();
      const publicKeyB64 = CryptoService.arrayBufferToBase64(keys.publicKeyRaw);

      console.log("[AUTH] Chaves geradas");
      console.log(
        "  Chave pública (primeiros 30 chars):",
        publicKeyB64.substring(0, 30)
      );

      // 2. CIFRAR CHAVE PRIVADA COM SENHA
      console.log("[AUTH] Cifrando chave privada com senha...");
      const { encryptedPrivateKey, salt, iv } =
        await CryptoService.encryptPrivateKey(keys.privateKey, password);
      console.log("[AUTH] Chave privada cifrada");

      const response = await fetch("http://localhost:3000/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          password,
          publicKey: publicKeyB64,
          encryptedPrivateKey,
          salt,
          iv,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erro ao registrar");
      }

      const data = await response.json();

      // 4. Salvar no estado
      setUser(data);
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setPublicKeyRaw(keys.publicKeyRaw);

      // 5. Salvar no localStorage (apenas para a sessão)
      localStorage.setItem("user", JSON.stringify(data));
      const privateKeyJWK = await crypto.subtle.exportKey(
        "jwk",
        keys.privateKey
      );
      localStorage.setItem("privateKeyJWK", JSON.stringify(privateKeyJWK));

      console.log("[AUTH] Registro concluído com sucesso");
    } catch (error) {
      console.error("[AUTH] Erro no registro:", error);
      throw error;
    }
  };

  const login = async (email: string, password: string) => {
    console.log("[AUTH] Iniciando login...");

    try {
      const response = await fetch("http://localhost:3000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error("Credenciais inválidas");
      }

      const data = await response.json();

      console.log("[AUTH] Login bem-sucedido:", data.name);

      // 2. VERIFICAR SE TEM CHAVE PRIVADA CIFRADA NO BANCO
      if (!data.encryptedPrivateKey || !data.salt || !data.iv) {
        throw new Error(
          "Chave privada não encontrada. Faça cadastro novamente."
        );
      }

      // 3. DECIFRAR CHAVE PRIVADA COM SENHA
      console.log(" [AUTH] Decifrando chave privada...");
      const privKey = await CryptoService.decryptPrivateKey(
        data.encryptedPrivateKey,
        data.salt,
        data.iv,
        password
      );
      console.log("[AUTH] Chave privada decifrada");

      // 4. Importar chave pública
      const pubKeyRaw = CryptoService.base64ToArrayBuffer(data.publicKey);
      const pubKey = await CryptoService.importPublicKey(pubKeyRaw);

      // 5. Salvar no estado
      setUser(data);
      setPrivateKey(privKey);
      setPublicKey(pubKey);
      setPublicKeyRaw(pubKeyRaw);

      // 6. Salvar no localStorage (apenas para a sessão)
      localStorage.setItem("user", JSON.stringify(data));
      const privateKeyJWK = await crypto.subtle.exportKey("jwk", privKey);
      localStorage.setItem("privateKeyJWK", JSON.stringify(privateKeyJWK));

      console.log("[AUTH] Login concluído com sucesso");
    } catch (error) {
      console.error("[AUTH] Erro no login:", error);
      throw error;
    }
  };

  const logout = () => {
    console.log("👋 [AUTH] Fazendo logout...");

    setUser(null);
    setPrivateKey(null);
    setPublicKey(null);
    setPublicKeyRaw(null);

    localStorage.removeItem("user");
    localStorage.removeItem("privateKeyJWK");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        privateKey,
        publicKey,
        publicKeyRaw,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

