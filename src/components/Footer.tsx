interface FooterProps {
  git: string;
  upstreamGit?: string;
}

const Footer = ({ git, upstreamGit }: FooterProps) => {
  return (
    <footer className="w-full py-6 text-center border-t border-[var(--app-panel-border)] bg-[var(--app-panel)] backdrop-blur-sm">
      <p className="text-slate-500 text-sm">
        Open Source Project. View this fork on{' '}
        <a 
          href={git} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-[var(--app-accent)] hover:text-[var(--app-accent)] hover:underline transition-colors font-medium"
        >
          uaktags/Suno-Architect
        </a>
        {upstreamGit && (
          <>
            {' '}• Original project by{' '}
            <a
              href={upstreamGit}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-white hover:underline transition-colors font-medium"
            >
              xiliourt/Suno-Architect
            </a>
          </>
        )}
        {' '}• Mastering engine integration based on{' '}
        <a
          href="https://github.com/entrepeneur4lyf/Web-Audio-Mastering"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-300 hover:text-white hover:underline transition-colors font-medium"
        >
          entrepeneur4lyf/Web-Audio-Mastering
        </a>
        {' '} (ISC)
      </p>
    </footer>
  );
};

export default Footer;
