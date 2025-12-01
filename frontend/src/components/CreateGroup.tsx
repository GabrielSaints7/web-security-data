// frontend/src/components/CreateGroup.tsx

import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { CryptoService } from "../services/crypto.service";

interface CreateGroupProps {
  onClose: () => void;
  onGroupCreated: () => void;
}

export function CreateGroup({ onClose, onGroupCreated }: CreateGroupProps) {
  const { user, publicKeyRaw } = useAuth();
  const [groupName, setGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [memberEmails, setMemberEmails] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!groupName.trim()) {
        throw new Error("Nome do grupo é obrigatório");
      }

      console.log("👥 [GROUP] Criando grupo:", groupName);

      // 1. Parse dos emails dos membros
      const emails = memberEmails
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0);

      console.log(`👥 [GROUP] Membros a adicionar: ${emails.length}`);

      // 2. Buscar dados dos membros
      const memberPromises = emails.map(async (email) => {
        const response = await fetch(
          `http://localhost:3000/auth/user/email/${email}`
        );
        if (!response.ok) {
          throw new Error(`Usuário não encontrado: ${email}`);
        }
        return response.json();
      });

      const members = await Promise.all(memberPromises);
      console.log(`✅ [GROUP] ${members.length} membros encontrados`);

      // 3. Adicionar a mim mesmo como primeiro membro
      const allMembers = [
        {
          id: user!.id,
          publicKey: CryptoService.arrayBufferToBase64(publicKeyRaw!),
        },
        ...members.map((m) => ({ id: m.id, publicKey: m.publicKey })),
      ];

      console.log(
        `👥 [GROUP] Total de membros (incluindo eu): ${allMembers.length}`
      );

      // 4. Gerar chave do grupo
      console.log("🔐 [GROUP] Gerando chave do grupo...");
      const groupKey = await CryptoService.generateGroupKey();
      const groupKeyRaw = await CryptoService.exportGroupKey(groupKey);

      // 5. Cifrar chave do grupo para cada membro
      console.log("🔒 [GROUP] Cifrando chave para cada membro...");
      const memberKeysPromises = allMembers.map(async (member) => {
        const memberPublicKeyRaw = CryptoService.base64ToArrayBuffer(
          member.publicKey
        );
        const { encryptedGroupKey, ephemeralPublicKey } =
          await CryptoService.encryptGroupKeyForMember(
            groupKeyRaw,
            memberPublicKeyRaw
          );

        return {
          userId: member.id,
          encryptedGroupKey,
          ephemeralPublicKey,
        };
      });

      const memberKeys = await Promise.all(memberKeysPromises);
      console.log("✅ [GROUP] Chave cifrada para todos os membros");

      // 6. Criar grupo no servidor
      console.log("📤 [GROUP] Enviando para o servidor...");
      const response = await fetch("http://localhost:3000/chat/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName,
          description: description || undefined,
          creatorId: user!.id,
          members: memberKeys,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Erro ao criar grupo");
      }

      const group = await response.json();
      console.log("✅ [GROUP] Grupo criado com sucesso:", group.id);

      // 7. Salvar chave do grupo no localStorage (para uso posterior)
      const groupKeyB64 = CryptoService.arrayBufferToBase64(groupKeyRaw);
      const groupKeys = JSON.parse(localStorage.getItem("groupKeys") || "{}");
      groupKeys[group.id] = groupKeyB64;
      localStorage.setItem("groupKeys", JSON.stringify(groupKeys));

      alert(`Grupo "${groupName}" criado com sucesso!`);
      onGroupCreated();
      onClose();
    } catch (error: any) {
      console.error("❌ [GROUP] Erro ao criar grupo:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Criar Grupo</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleCreateGroup} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nome do Grupo *
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Ex: Família, Trabalho, Amigos..."
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Descrição (opcional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição do grupo..."
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Membros (separados por vírgula)
            </label>
            <textarea
              value={memberEmails}
              onChange={(e) => setMemberEmails(e.target.value)}
              placeholder="usuario1@email.com, usuario2@email.com"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
            <p className="text-xs text-gray-500 mt-1">
              Você será adicionado automaticamente como administrador
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
              disabled={loading}
            >
              {loading ? "Criando..." : "Criar Grupo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
