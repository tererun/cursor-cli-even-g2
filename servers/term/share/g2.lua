-- Even G2 HUD (38x12 by default). Source from your nvim config when $G2_TERM is set:
--   if vim.env.G2_TERM == "1" then dofile("/opt/cursor-cli-even-g2/servers/term/share/g2.lua") end
vim.opt.number = true
vim.opt.relativenumber = false
vim.opt.signcolumn = "no"
vim.opt.foldcolumn = "0"
vim.opt.laststatus = 1
vim.opt.cmdheight = 1
vim.opt.ruler = false
vim.opt.showmode = true
vim.opt.wrap = false
vim.opt.scrolloff = 0
vim.opt.sidescrolloff = 0
vim.opt.termguicolors = false
pcall(vim.cmd, "colorscheme default")
