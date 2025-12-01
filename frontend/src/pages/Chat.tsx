import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import socketService from "../services/socket.service";
import { CryptoService } from "../services/crypto.service";
import { Socket } from "socket.io-client";

interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: Date;
  decrypted?: boolean;
}

interface Chat {
  userId: string;
  name: string;
  email: string;
  lastMessage?: Date;
}

export function ChatPage() {
  const { user, privateKey, publicKey, publicKeyRaw, logout } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  // Estado das conversas
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");

  // Estado para adicionar novo chat
  const [showAddChat, setShowAddChat] = useState(false);
  const [newChatEmail, setNewChatEmail] = useState("");

  // Loading states
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // ⭐ useEffect para conectar WebSocket
  useEffect(() => {
    if (!user) return;

    console.log("🔌 [CHAT] Inicializando WebSocket...");

    // Conectar ao WebSocket
    const sock = socketService.connect(user.id);
    setSocket(sock);

    // ⭐ Registrar listener para mensagens recebidas
    const unsubscribe = socketService.onMessage((encryptedMessage) => {
      console.log("📨 [CHAT] Mensagem recebida, processando...");

      // Verificar se a mensagem é para nós
      if (encryptedMessage.receiverId === user.id) {
        console.log("✅ [CHAT] Mensagem é para nós, descriptografando...");
        decryptAndAddMessage(encryptedMessage);
      } else {
        console.log("⏭️ [CHAT] Mensagem não é para nós, ignorando");
      }
    });

    console.log("✅ [CHAT] WebSocket configurado");

    // Cleanup ao desmontar
    return () => {
      console.log("🧹 [CHAT] Limpando WebSocket...");
      unsubscribe();
    };
  }, [user?.id]);

  // No início do componente Chat, adicione este useEffect:

  useEffect(() => {
    // Debug: verificar se temos as chaves necessárias
    console.log("🔍 [CHAT] Verificando estado de autenticação...");
    console.log("  User:", user?.name);
    console.log(
      "  PrivateKey:",
      privateKey ? "✅ Disponível" : "❌ Não disponível"
    );
    console.log(
      "  PublicKey:",
      publicKey ? "✅ Disponível" : "❌ Não disponível"
    );

    if (!privateKey && user) {
      console.warn("⚠️ [CHAT] Usuário logado mas sem chave privada!");
      console.warn("  Faça logout e login novamente.");
    }
  }, [user, privateKey, publicKey]);

  // Carregar lista de chats
  useEffect(() => {
    if (user) {
      loadChats();
    }
  }, [user]);

  // Auto-scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadChats = async () => {
    try {
      const response = await fetch(
        `http://localhost:3000/chat/user/${user!.id}/chats`
      );
      const data = await response.json();
      setChats(data);
    } catch (error) {
      console.error("Erro ao carregar chats:", error);
    }
  };

  const handleMessageReceived = async (data: any) => {
    console.log("📨 [CHAT] Mensagem recebida via WebSocket");

    // Se a mensagem é da conversa atual, descriptografar e exibir
    if (selectedChat && data.senderId === selectedChat.userId) {
      await decryptAndAddMessage(data);
    }

    // Atualizar lista de chats
    loadChats();
  };

  const decryptAndAddMessage = async (encryptedMessage: any) => {
    try {
      console.log("📨 [CHAT] Nova mensagem recebida, descriptografando...");
      console.log("  Sender:", encryptedMessage.senderId);
      console.log(
        "  Encrypted data (primeiros 50):",
        encryptedMessage.encryptedData?.substring(0, 50)
      );

      // ⚠️ VERIFICAR SE TEMOS CHAVE PRIVADA
      if (!privateKey) {
        console.error("❌ [CHAT] Chave privada não disponível!");
        throw new Error("Chave privada não encontrada");
      }

      console.log("✅ [CHAT] Chave privada disponível");

      // 1. Importar chave pública efêmera do remetente
      console.log("🔑 [CHAT] Importando chave efêmera do remetente...");
      console.log(
        "  senderEphemPk (primeiros 50):",
        encryptedMessage.senderEphemPk?.substring(0, 50)
      );

      const senderEphemPkRaw = CryptoService.base64ToArrayBuffer(
        encryptedMessage.senderEphemPk
      );
      const senderEphemPk = await CryptoService.importPublicKey(
        senderEphemPkRaw
      );
      console.log("✅ [CHAT] Chave efêmera importada");

      // 2. Calcular segredo compartilhado usando NOSSA chave privada
      console.log("🔐 [CHAT] Calculando segredo compartilhado...");
      const sharedSecret = await CryptoService.computeSharedSecret(
        privateKey, // NOSSA chave privada (do destinatário)
        senderEphemPk // Chave pública efêmera do remetente
      );
      console.log("✅ [CHAT] Segredo compartilhado calculado");

      // 3. Derivar chave AES
      console.log("🔐 [CHAT] Derivando chave AES...");
      const aesKey = await CryptoService.deriveAESKey(sharedSecret);
      console.log("✅ [CHAT] Chave AES derivada");

      // 4. Descriptografar mensagem
      console.log("🔓 [CHAT] Descriptografando mensagem...");
      const decryptedText = await CryptoService.decryptMessage(
        encryptedMessage.encryptedData,
        encryptedMessage.nonce,
        aesKey
      );
      console.log(
        "✅ [CHAT] Mensagem descriptografada:",
        decryptedText.substring(0, 50)
      );

      // 5. Adicionar à lista de mensagens
      const message = {
        id: encryptedMessage.id,
        senderId: encryptedMessage.senderId,
        text: decryptedText,
        createdAt: new Date(encryptedMessage.createdAt),
        decrypted: true,
      };

      // ⭐ Verificar se a mensagem já existe (evitar duplicatas)
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === message.id);
        if (exists) {
          console.log("⚠️ [CHAT] Mensagem já existe, ignorando");
          return prev;
        }
        console.log("✅ [CHAT] Adicionando mensagem à lista");
        return [...prev, message];
      });

      // ⭐ Atualizar último contato na lista de chats
      setChats((prevChats) => {
        return prevChats.map((chat) => {
          if (chat.userId === encryptedMessage.senderId) {
            return {
              ...chat,
              lastMessage: decryptedText.substring(0, 50),
              lastMessageTime: new Date(),
            };
          }
          return chat;
        });
      });

      console.log("✅ [CHAT] Mensagem adicionada à lista");
    } catch (error) {
      console.error("❌ [CHAT] Erro ao descriptografar mensagem:", error);
      console.error("  Detalhes:", {
        hasPrivateKey: !!privateKey,
        encryptedData: encryptedMessage.encryptedData?.substring(0, 50),
        nonce: encryptedMessage.nonce?.substring(0, 50),
        senderEphemPk: encryptedMessage.senderEphemPk?.substring(0, 50),
      });

      // Adicionar mensagem de erro
      setMessages((prev) => [
        ...prev,
        {
          id: encryptedMessage.id || Date.now().toString(),
          senderId: encryptedMessage.senderId,
          text: "[Erro ao descriptografar - verifique o console]",
          createdAt: new Date(),
          decrypted: false,
        },
      ]);
    }
  };

  // frontend/src/pages/Chat.tsx

  const loadConversation = async (chat: Chat) => {
    setSelectedChat(chat);
    setLoadingMessages(true);
    setMessages([]);

    try {
      console.log(`📜 [CHAT] Carregando histórico com ${chat.name}`);

      // 1. Buscar mensagens do servidor
      const response = await fetch(
        `http://localhost:3000/chat/conversations/${user!.id}/${chat.userId}`
      );
      const data = await response.json();

      console.log(`📜 [CHAT] ${data.length} mensagens encontradas`);

      // 2. Descriptografar todas as mensagens
      const decryptedMessages: Message[] = [];

      for (const msg of data) {
        try {
          const isOutgoing = msg.senderId === user!.id;

          let decryptedText: string;

          if (isOutgoing) {
            // ========== MENSAGEM QUE EU ENVIEI ==========
            console.log("📤 [CHAT] Descriptografando mensagem que enviei...");

            // Usar os campos "sender*" que foram cifrados para mim
            if (
              !msg.senderEncryptedData ||
              !msg.senderNonce ||
              !msg.senderEphemPkForSelf
            ) {
              console.warn(
                "⚠️ [CHAT] Mensagem antiga sem criptografia para remetente"
              );
              throw new Error("Mensagem enviada antes da atualização");
            }

            // Importar minha chave pública efêmera que usei para cifrar para mim mesmo
            const myEphemPkRaw = CryptoService.base64ToArrayBuffer(
              msg.senderEphemPkForSelf
            );
            const myEphemPk = await CryptoService.importPublicKey(myEphemPkRaw);

            // Calcular segredo compartilhado usando MINHA chave privada atual
            const sharedSecret = await CryptoService.computeSharedSecret(
              privateKey!,
              myEphemPk
            );

            // Derivar chave AES
            const aesKey = await CryptoService.deriveAESKey(sharedSecret);

            // Descriptografar
            decryptedText = await CryptoService.decryptMessage(
              msg.senderEncryptedData,
              msg.senderNonce,
              aesKey
            );

            console.log("✅ [CHAT] Mensagem que enviei descriptografada");
          } else {
            // ========== MENSAGEM QUE RECEBI ==========
            console.log("📥 [CHAT] Descriptografando mensagem que recebi...");

            // Importar chave pública efêmera do remetente
            const senderEphemPkRaw = CryptoService.base64ToArrayBuffer(
              msg.senderEphemPk
            );
            const senderEphemPk = await CryptoService.importPublicKey(
              senderEphemPkRaw
            );

            // Calcular segredo compartilhado usando minha chave privada
            const sharedSecret = await CryptoService.computeSharedSecret(
              privateKey!,
              senderEphemPk
            );

            // Derivar chave AES
            const aesKey = await CryptoService.deriveAESKey(sharedSecret);

            // Descriptografar
            decryptedText = await CryptoService.decryptMessage(
              msg.encryptedData,
              msg.nonce,
              aesKey
            );

            console.log("✅ [CHAT] Mensagem que recebi descriptografada");
          }

          decryptedMessages.push({
            id: msg.id,
            senderId: msg.senderId,
            text: decryptedText,
            createdAt: new Date(msg.createdAt),
            decrypted: true,
          });
        } catch (error) {
          console.error(
            "❌ [CHAT] Erro ao descriptografar mensagem:",
            msg.id,
            error
          );
          decryptedMessages.push({
            id: msg.id,
            senderId: msg.senderId,
            text: "[Erro ao descriptografar]",
            createdAt: new Date(msg.createdAt),
            decrypted: false,
          });
        }
      }

      setMessages(decryptedMessages);
      console.log(`✅ [CHAT] ${decryptedMessages.length} mensagens carregadas`);
    } catch (error) {
      console.error("❌ [CHAT] Erro ao carregar conversa:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageInput.trim() || !selectedChat || !socket) return;

    setSendingMessage(true);

    try {
      console.log("📤 [CHAT] Enviando mensagem...");

      // 1. Buscar chave pública do destinatário
      const response = await fetch(
        `http://localhost:3000/auth/user/${selectedChat.userId}`
      );

      if (!response.ok) {
        throw new Error("Erro ao buscar destinatário");
      }

      const receiver = await response.json();

      console.log("🔍 [CHAT] Destinatário encontrado:", receiver.name);

      // Validar chave pública
      if (!receiver || !receiver.publicKey) {
        throw new Error("Destinatário não possui chave pública");
      }

      const receiverPublicKeyRaw = CryptoService.base64ToArrayBuffer(
        receiver.publicKey
      );
      const receiverPublicKey = await CryptoService.importPublicKey(
        receiverPublicKeyRaw
      );

      // ========== CIFRAR PARA O DESTINATÁRIO ==========
      console.log("🔒 [CHAT] Cifrando mensagem para destinatário...");

      // Gerar par efêmero para o destinatário
      const ephemeralKeysForReceiver = await CryptoService.generateKeyPair();

      // Calcular segredo compartilhado com destinatário
      const sharedSecretForReceiver = await CryptoService.computeSharedSecret(
        ephemeralKeysForReceiver.privateKey,
        receiverPublicKey
      );

      // Derivar chave AES para destinatário
      const aesKeyForReceiver = await CryptoService.deriveAESKey(
        sharedSecretForReceiver
      );

      // Cifrar para destinatário
      const { encryptedData, nonce } = await CryptoService.encryptMessage(
        messageInput,
        aesKeyForReceiver
      );
      
      console.log("✅ [CHAT] Mensagem cifrada para destinatário");

      // ========== CIFRAR PARA MIM MESMO ==========
      console.log("🔒 [CHAT] Cifrando mensagem para mim mesmo...");

      if (!publicKeyRaw) {
        throw new Error("Minha chave pública não disponível");
      }

      // Gerar OUTRO par efêmero para mim mesmo
      const ephemeralKeysForSelf = await CryptoService.generateKeyPair();

      // Importar minha própria chave pública
      const myPublicKey = await CryptoService.importPublicKey(publicKeyRaw);

      // Calcular segredo compartilhado comigo mesmo
      const sharedSecretForSelf = await CryptoService.computeSharedSecret(
        ephemeralKeysForSelf.privateKey,
        myPublicKey
      );

      // Derivar chave AES para mim
      const aesKeyForSelf = await CryptoService.deriveAESKey(
        sharedSecretForSelf
      );

      // Cifrar para mim mesmo
      const { encryptedData: senderEncryptedData, nonce: senderNonce } =
        await CryptoService.encryptMessage(messageInput, aesKeyForSelf);

      console.log("✅ [CHAT] Mensagem cifrada para mim mesmo");

      console.log("✅ [CHAT] Mensagem cifrada, enviando via WebSocket...");
      // ========== ENVIAR VIA WEBSOCKET ==========
      console.log("📡 [CHAT] Enviando via WebSocket...");

      socket.emit("message:send", {
        senderId: user!.id,
        receiverId: selectedChat.userId,
        // Para o destinatário
        encryptedData,
        nonce,
        senderEphemPk: CryptoService.arrayBufferToBase64(
          ephemeralKeysForReceiver.publicKeyRaw
        ),
        // ⭐ Para mim mesmo
        senderEncryptedData,
        senderNonce,
        senderEphemPkForSelf: CryptoService.arrayBufferToBase64(
          ephemeralKeysForSelf.publicKeyRaw
        ),
      });

      // Adicionar à lista local (já descriptografada)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          senderId: user!.id,
          text: messageInput,
          createdAt: new Date(),
          decrypted: true,
        },
      ]);

      setMessageInput("");
      console.log("✅ [CHAT] Mensagem enviada com sucesso!");
    } catch (error) {
      console.error("❌ [CHAT] Erro ao enviar mensagem:", error);
      alert(`Erro ao enviar mensagem: ${error.message}`);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleAddChat = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // Buscar usuário por email
      const response = await fetch(
        `http://localhost:3000/auth/user/email/${newChatEmail}`
      );

      if (!response.ok) {
        alert("Usuário não encontrado");
        return;
      }

      const foundUser = await response.json();

      // Adicionar à lista de chats
      const newChat: Chat = {
        userId: foundUser.id,
        name: foundUser.name,
        email: foundUser.email,
      };

      setChats((prev) => [...prev, newChat]);
      setSelectedChat(newChat);
      setShowAddChat(false);
      setNewChatEmail("");
    } catch (error) {
      console.error("Erro ao adicionar chat:", error);
      alert("Erro ao adicionar contato");
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">🔐 Chat Seguro</h1>
            <p className="text-sm text-blue-100">Olá, {user?.name}</p>
          </div>
          <button
            onClick={logout}
            className="bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg transition"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex max-w-7xl mx-auto w-full bg-white shadow-xl">
        {/* Sidebar - Lista de Chats */}
        <aside className="w-80 border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <button
              onClick={() => setShowAddChat(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition"
            >
              ➕ Nova Conversa
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {chats.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                Nenhuma conversa ainda
              </div>
            ) : (
              chats.map((chat) => (
                <button
                  key={chat.userId}
                  onClick={() => loadConversation(chat)}
                  className={`w-full p-4 text-left border-b border-gray-100 hover:bg-gray-50 transition ${
                    selectedChat?.userId === chat.userId ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="font-semibold text-gray-800">{chat.name}</div>
                  <div className="text-sm text-gray-500">{chat.email}</div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Área de Mensagens */}
        <main className="flex-1 flex flex-col">
          {selectedChat ? (
            <>
              {/* Header do Chat */}
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h2 className="font-bold text-lg">{selectedChat.name}</h2>
                <p className="text-sm text-gray-500">{selectedChat.email}</p>
              </div>

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMessages ? (
                  <div className="text-center text-gray-500">
                    Carregando mensagens...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-gray-500">
                    Nenhuma mensagem ainda. Inicie a conversa!
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.senderId === user!.id
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-md px-4 py-2 rounded-2xl ${
                          msg.senderId === user!.id
                            ? "bg-blue-600 text-white"
                            : "bg-gray-200 text-gray-800"
                        }`}
                      >
                        <p>{msg.text}</p>
                        <p className="text-xs opacity-70 mt-1">
                          {msg.createdAt.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {msg.decrypted && " 🔓"}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input de Mensagem */}
              <form
                onSubmit={sendMessage}
                className="p-4 border-t border-gray-200"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={sendingMessage}
                  />
                  <button
                    type="submit"
                    disabled={sendingMessage || !messageInput.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendingMessage ? "⏳" : "📤"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              Selecione uma conversa para começar
            </div>
          )}
        </main>
      </div>

      {/* Modal - Adicionar Chat */}
      {showAddChat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Nova Conversa</h3>
            <form onSubmit={handleAddChat} className="space-y-4">
              <input
                type="email"
                value={newChatEmail}
                onChange={(e) => setNewChatEmail(e.target.value)}
                placeholder="Email do usuário"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddChat(false)}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition"
                >
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

