Índice
    Pré-requisitos

    Instalação e Configuração

    Execução do Servidor

    Utilização da API

    Fluxo de Criptografia

    Exemplos Práticos


Pré-requisitos

    Node.js (versão 18 ou superior)

    PostgreSQL (versão 12 ou superior)

    npm ou yarn

Verificações Iniciais
bash


## Instalação e Configuração
### 1. Clone e Acesso ao Projeto
git clone https://github.com/GabrielSaints7/encrypt-chat

### Navegue até o diretório do projeto
cd nodejs-chat

### Verifique a estrutura de arquivos
ls -la

## 2. Instalação de Dependências
### Instalar todas as dependências
npm install

## Dependências que serão instaladas:
*- @prisma/client: ORM para banco de dados*

*- express: Framework web*

*- @noble/curves: Implementação de curvas elípticas para criptografia*

*- prisma: CLI do Prisma ORM*


## 3. Configuração do Banco de Dados
### 3.1. .env já configurado para banco local
* Subir Banco em modo dev em terminal separado*
* npx prisma dev *


4. Configuração do Prisma ORM
bash

### Gerar cliente do Prisma
npx prisma generate

### Executar migrations para criar tabelas
npx prisma migrate dev --name init

### (Opcional) Visualizar dados no Prisma Studio
npx prisma studio

### Execução do Servidor
Iniciar o Servidor

### Desenvolvimento
npm run dev

### Ou execute diretamente
node src/app.js

# Verificação do Servidor

Quando inicia, deverá ver no console:

* Conectado ao banco de dados PostgreSQL * 

* Servidor rodando na porta 3000 * 

* Endpoints disponíveis: * 
  
   http://localhost:3000/health

   http://localhost:3000/api/users

   http://localhost:3000/api/messages

   http://localhost:3000/api/groups


# Importação de rotas para uso de API
import o arquivo ./Nodejs-chat.postman_collection.json da raiz para o postman


