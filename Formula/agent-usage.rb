# Homebrew formula template for agent-usage-stats CLI.
# Not wired to a live tap — use for local testing or fork into your own tap.
#
# Local install from git checkout:
#   pnpm build && brew install --build-from-source ./Formula/agent-usage.rb
#
class AgentUsage < Formula
  desc "Local-first AI session usage analyzer"
  homepage "https://github.com/gega-dkv/agent-usage-stats"
  version "0.1.0"
  license "MIT"

  depends_on "node@20"

  # Replace with a release tarball when publishing:
  # url "https://github.com/gega-dkv/agent-usage-stats/archive/refs/tags/v0.1.0.tar.gz"
  # sha256 "..."

  head do
    url "https://github.com/gega-dkv/agent-usage-stats.git", branch: "main"
  end

  def install
    system "npm", "install", "-g", "pnpm@9"
    ENV["PATH"] = "#{HOMEBREW_PREFIX}/bin:#{ENV["PATH"]}"
    system "pnpm", "install", "--frozen-lockfile"
    system "pnpm", "build"
    cd "apps/cli" do
      bin.install "dist/index.js" => "agent-usage"
      (libexec/"web").install Dir["web/*"]
      (libexec/"web/.next").install Dir["web/.next/*"] if (buildpath/"apps/cli/web/.next").exist?
    end
    # Wrapper so bundled web/ resolves next to the installed script
    (bin/"agent-usage").write_env_script libexec/"agent-usage", AGENT_USAGE_CLI_ROOT: libexec
  end

  test do
    assert_match "agent-usage", shell_output("#{bin}/agent-usage --help")
  end
end
