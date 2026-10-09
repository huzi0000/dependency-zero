import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { EcosystemMarquee } from "@/components/EcosystemMarquee";
import { ProblemSection } from "@/components/ProblemSection";
import { GlobalNetwork } from "@/components/GlobalNetwork";
import { HowItWorks } from "@/components/HowItWorks";
import { FinalCTA } from "@/components/FinalCTA";
import { Footer } from "@/components/Footer";

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main id="main">
        <Hero />
        <EcosystemMarquee />
        <ProblemSection />
        <GlobalNetwork />
        <div id="how-it-works">
          <HowItWorks />
        </div>
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}