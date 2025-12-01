// frontend/src/components/GroupChat.tsx

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { CryptoService } from "../services/crypto.service";
import socketService from "../services/socket.service";

interface GroupChatProps {
  group: any;
  onBack: () => void;
}

interface GroupMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: Date;
  decrypted: boolean;
}

export function GroupChat({ group, onBack }: GroupChatProps) {
  const { user, privateKey } = useAuth();
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [groupKey, setGroupKey] = useState<CryptoKey | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Carregar chave do grupo e mensagens
  useEffect(() => {
    loadGroupKeyAndMessages();

    // Listener para mensagens novas
    const unsubscribe = socketService.onMessage((data) => {
      if (data.groupId === group.id) {
        console.log("👥 [GROUP-CHAT] Nova mensagem de grupo recebida");
        decryptAndAddMessage(data);
      }
    });

    return () => unsubscribe();
  }, [group.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadGroupKeyAndMessages = async () => {
    try {
      console.log("🔐 [GROUP-CHAT] Carregando chave do grupo...");

      // 1. Decifrar chave do grupo
      const groupKeyRaw = await CryptoService.decryptGroupKey(
        group.myEncryptedGroupKey,
        group.myEphemeralPublicKey,
        privateKey!
      );

      const gKey = await CryptoService.importGroupKey(groupKeyRaw);
      setGroupKey(gKey);

      // Salvar no localStorage para uso posterior
      const groupKeyB64 = CryptoService.arrayBufferToBase64(groupKeyRaw);
      const groupKeys = JSON.parse(localStorage.getItem("groupKeys") || "{}");
      groupKeys[group.id] = groupKeyB64;
      localStorage.setItem("groupKeys", JSON.stringify(groupKeys));

      console.log("✅ [GROUP-CHAT] Chave do grupo carregada");

      // 2. Carregar mensagens
      console.log("📜 [GROUP-CHAT] Carregando mensagens...");
      const response = await fetch(
        `http://localhost:3000/chat/group/${group.id}/messages?userId=${
          user!.id
        }`
      );

      if (!response.ok) {
        throw new Error("Erro ao carregar mensagens");
      }

      const data = await response.json();
      console.log(`📜 [GROUP-CHAT] ${data.length} mensagens encontradas`);

      // 3. Descriptografar mensagens
      const decryptedMessages: GroupMessage[] = [];

      for (const msg of data) {
        try {
          const decryptedText = await CryptoService.decryptGroupMessage(
            msg.encryptedData,
            msg.nonce,
            gKey
          );

          decryptedMessages.push({
            id: msg.id,
            senderId: msg.senderId,
            senderName: msg.sender.name,
            text: decryptedText,
            createdAt: new Date(msg.createdAt),
            decrypted: true,
          });
        } catch (error) {
          console.error("❌ [GROUP-CHAT] Erro ao descriptografar:", msg.id);
          decryptedMessages.push({
            id: msg.id,
            senderId: msg.senderId,
            senderName: msg.sender.name,
            text: "[Erro ao descriptografar]",
            createdAt: new Date(msg.createdAt),
            decrypted: false,
          });
        }
      }

      setMessages(decryptedMessages);
      console.log("✅ [GROUP-CHAT] Mensagens carregadas");
    } catch (error) {
      console.error("❌ [GROUP-CHAT] Erro:", error);
      alert("Erro ao carregar grupo: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const decryptAndAddMessage = async (encryptedMessage: any) => {
    try {
      if (!groupKey) {
        console.error("❌ [GROUP-CHAT] Chave do grupo não disponível");
        return;
      }

      const decryptedText = await CryptoService.decryptGroupMessage(
        encryptedMessage.encryptedData,
        encryptedMessage.nonce,
        groupKey
      );

      const message: GroupMessage = {
        id: encryptedMessage.id,
        senderId: encryptedMessage.senderId,
        senderName: encryptedMessage.senderName,
        text: decryptedText,
        createdAt: new Date(encryptedMessage.createdAt),
        decrypted: true,
      };

      setMessages((prev) => {
        const exists = prev.some((m) => m.id === message.id);
        if (exists) return prev;
        return [...prev, message];
      });
    } catch (error) {
      console.error("❌ [GROUP-CHAT] Erro ao descriptografar:", error);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageInput.trim() || !groupKey) return;

    setSending(true);

    try {
      console.log("📤 [GROUP-CHAT] Enviando mensagem...");

      // Cifrar mensagem
      const { encryptedData, nonce } = await CryptoService.encryptGroupMessage(
        messageInput,
        groupKey
      );

      // Enviar via WebSocket
      socketService.getSocket()?.emit("group:message:send", {
        groupId: group.id,
        senderId: user!.id,
        encryptedData,
        nonce,
        keyVersion: group.myKeyVersion || 1,
      });

      // Adicionar à lista local
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          senderId: user!.id,
          senderName: user!.name,
          text: messageInput,
          createdAt: new Date(),
          decrypted: true,
        },
      ]);

      setMessageInput("");
      console.log("✅ [GROUP-CHAT] Mensagem enviada");
    } catch (error) {
      console.error("❌ [GROUP-CHAT] Erro ao enviar:", error);
      alert("Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const handleAddMember = async () => {
    try {
      if (!newMemberEmail.trim()) return;

      console.log("➕ [GROUP-CHAT] Adicionando membro:", newMemberEmail);

      // 1. Buscar usuário
      const userResponse = await fetch(
        `http://localhost:3000/auth/user/email/${newMemberEmail}`
      );

      if (!userResponse.ok) {
        throw new Error("Usuário não encontrado");
      }

      const newMember = await userResponse.json();

      // 2. Cifrar chave do grupo para o novo membro
      const groupKeyRaw = CryptoService.base64ToArrayBuffer(
        JSON.parse(localStorage.getItem("groupKeys") || "{}")[group.id]
      );

      const memberPublicKeyRaw = CryptoService.base64ToArrayBuffer(
        newMember.publicKey
      );
      const { encryptedGroupKey, ephemeralPublicKey } =
        await CryptoService.encryptGroupKeyForMember(
          groupKeyRaw,
          memberPublicKeyRaw
        );

      // 3. Adicionar no servidor
      const response = await fetch("http://localhost:3000/chat/group/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: group.id,
          userId: newMember.id,
          encryptedGroupKey,
          ephemeralPublicKey,
          addedBy: user!.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }

      alert(`${newMember.name} adicionado ao grupo!`);
      setNewMemberEmail("");
      setShowAddMember(false);
    } catch (error: any) {
      console.error("❌ [GROUP-CHAT] Erro:", error);
      alert("Erro: " + error.message);
    }
  };

  const handleLeaveGroup = async () => {
    if (!confirm("Deseja realmente sair do grupo?")) return;

    try {
      const response = await fetch(
        `http://localhost:3000/chat/group/${group.id}/member/${user!.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ removedBy: user!.id }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }

      alert("Você saiu do grupo");
      onBack();
    } catch (error: any) {
      alert("Erro: " + error.message);
    }
  };

  const handleDeleteGroup = async () => {
    if (
      !confirm(
        "Deseja realmente DELETAR o grupo? Esta ação não pode ser desfeita!"
      )
    )
      return;

    try {
      const response = await fetch(
        `http://localhost:3000/chat/group/${group.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user!.id }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }

      alert("Grupo deletado");
      onBack();
    } catch (error: any) {
      alert("Erro: " + error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Carregando grupo...</div>
      </div>
    );
  }

  const isAdmin = group.creatorId === user!.id;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-600 hover:text-gray-800"
          >
            ← Voltar
          </button>
          <div>
            <h2 className="font-semibold text-lg">{group.name}</h2>
            <p className="text-sm text-gray-500">
              {group._count.members} membros
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowMembers(!showMembers)}
            className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
          >
            👥 Membros
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setShowAddMember(!showAddMember)}
                className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                ➕ Adicionar
              </button>
              <button
                onClick={handleDeleteGroup}
                className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                🗑️ Deletar
              </button>
            </>
          )}

          {!isAdmin && (
            <button
              onClick={handleLeaveGroup}
              className="px-3 py-1 text-sm bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
            >
              🚪 Sair
            </button>
          )}
        </div>
      </div>

      {/* Modal Adicionar Membro */}
      {showAddMember && (
        <div className="bg-blue-50 border-b px-4 py-3">
          <div className="flex gap-2">
            <input
              type="email"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              placeholder="Email do novo membro"
              className="flex-1 px-3 py-2 border rounded"
            />
            <button
              onClick={handleAddMember}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Adicionar
            </button>
            <button
              onClick={() => setShowAddMember(false)}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de Membros */}
      {showMembers && (
        <div className="bg-gray-50 border-b px-4 py-3">
          <h3 className="font-semibold mb-2">Membros do Grupo:</h3>
          <div className="space-y-1">
            {group.members?.map((member: any) => (
              <div
                key={member.id}
                className="flex items-center justify-between"
              >
                <span className="text-sm">
                  {member.user.name} {member.role === "admin" && "👑"}
                  {member.userId === user!.id && " (você)"}
                </span>
                {isAdmin && member.userId !== user!.id && (
                  <button
                    onClick={async () => {
                      if (confirm(`Remover ${member.user.name}?`)) {
                        try {
                          await fetch(
                            `http://localhost:3000/chat/group/${group.id}/member/${member.userId}`,
                            {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ removedBy: user!.id }),
                            }
                          );
                          alert("Membro removido");
                          window.location.reload();
                        } catch (error) {
                          alert("Erro ao remover membro");
                        }
                      }
                    }}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Remover
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map((msg) => {
          const isMe = msg.senderId === user!.id;

          return (
            <div
              key={msg.id}
              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-4 py-2 ${
                  isMe
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-gray-200"
                }`}
              >
                {!isMe && (
                  <div className="text-xs font-semibold mb-1 text-gray-600">
                    {msg.senderName}
                  </div>
                )}
                <div className={msg.decrypted ? "" : "text-red-500 italic"}>
                  {msg.text}
                </div>
                <div
                  className={`text-xs mt-1 ${
                    isMe ? "text-blue-100" : "text-gray-500"
                  }`}
                >
                  {msg.createdAt.toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="bg-white border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder="Digite sua mensagem..."
            className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={sending}
          />
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
            disabled={sending || !messageInput.trim()}
          >
            {sending ? "..." : "📤"}
          </button>
        </div>
      </form>
    </div>
  );
}
